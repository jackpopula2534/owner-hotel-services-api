import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { PromoteToInventoryDto } from './dto/promote-to-inventory.dto';
import { DemoteFromInventoryDto } from './dto/demote-from-inventory.dto';
import { SourceWarehouseResolver } from '../../inventory/warehouses/source-warehouse.resolver';

/**
 * ย้ายเมนูขึ้น-ลงระหว่าง "นับในตัวเมนู" กับ "คลังกลางเป็นเจ้าของยอด"
 *
 * ทางเดินเดียวจากระดับ 1 → ระดับ 2 ที่ไม่ทำของหาย: ยอดที่ค้างอยู่ในเมนูต้อง
 * โผล่เป็นใบรับของในคลังพร้อมกับที่เมนูถูกปิดการนับ — ถ้าทำสองขั้นตอนแยกกัน
 * ผู้ใช้จะเจอช่วงที่ของหายไปจากทั้งสองที่ หรือถูกนับซ้ำสองที่
 *
 * ทุกอย่างอยู่ใน transaction เดียว รวมถึงการออกเลข SKU
 */
@Injectable()
export class MenuInventoryPromoteService {
  private readonly logger = new Logger(MenuInventoryPromoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
    private readonly sourceWarehouse: SourceWarehouseResolver,
  ) {}

  async promote(
    restaurantId: string,
    menuItemId: string,
    dto: PromoteToInventoryDto,
    tenantId: string,
    userId?: string,
  ) {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: {
        id: true,
        name: true,
        price: true,
        cost: true,
        trackStock: true,
        stockQty: true,
        inventoryItemId: true,
      },
    });
    if (!menuItem) {
      throw new NotFoundException(`Menu item ${menuItemId} not found`);
    }
    if (menuItem.inventoryItemId) {
      throw new ConflictException('เมนูนี้ผูกกับสินค้าในคลังอยู่แล้ว');
    }

    const hasAddon = await this.addonService.hasActiveAddon(tenantId, 'INVENTORY_MODULE');
    if (!hasAddon) {
      throw new BadRequestException(
        'ต้องเปิดใช้งานระบบคลังสินค้า (INVENTORY_MODULE) ก่อนจึงจะย้ายเข้าคลังกลางได้',
      );
    }

    const warehouseId = await this.resolveWarehouseId(restaurantId, tenantId, dto.warehouseId);
    if (!warehouseId) {
      throw new BadRequestException('ยังไม่มีคลังสินค้าที่ใช้งานได้ — สร้างคลังก่อนจึงจะย้ายได้');
    }

    if (dto.categoryId) {
      const category = await this.prisma.itemCategory.findFirst({
        where: { id: dto.categoryId, tenantId },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException('ไม่พบหมวดสินค้าที่เลือก');
      }
    }

    // ยอดที่จะยกไป — เมนูที่ไม่ได้เปิดนับสต๊อกก็ย้ายได้ แค่เริ่มที่ 0
    const openingQty = menuItem.trackStock ? menuItem.stockQty : 0;
    const unitCost = menuItem.cost ? Number(menuItem.cost) : 0;

    const result = await this.prisma.$transaction(async (tx) => {
      const sku = dto.sku?.trim() || (await this.nextSku(tx, tenantId));

      const taken = await tx.inventoryItem.findFirst({
        where: { tenantId, sku },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException(`รหัสสินค้า "${sku}" ถูกใช้ไปแล้ว`);
      }

      const inventoryItem = await tx.inventoryItem.create({
        data: {
          tenantId,
          sku,
          name: menuItem.name,
          categoryId: dto.categoryId ?? null,
          unit: dto.unit ?? 'PIECE',
          itemType: 'FINISHED_GOOD',
          // ราคาขายของเมนูคือราคาขายของสินค้าตัวนี้ — หน้า "สินค้าหน้าร้าน" คิดกำไรจากตรงนี้
          sellingPrice: menuItem.price,
        },
      });

      if (openingQty !== 0) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            warehouseId,
            itemId: inventoryItem.id,
            type: 'GOODS_RECEIVE',
            quantity: openingQty,
            unitCost,
            totalCost: openingQty * unitCost,
            referenceType: 'menu_promotion',
            referenceId: menuItem.id,
            notes: `ยกยอดจากเมนู "${menuItem.name}" เข้าคลังกลาง`,
            createdBy: userId ?? 'system',
          },
        });

        await tx.warehouseStock.upsert({
          where: { warehouseId_itemId: { warehouseId, itemId: inventoryItem.id } },
          create: {
            warehouseId,
            itemId: inventoryItem.id,
            quantity: openingQty,
            avgCost: unitCost,
            totalValue: openingQty * unitCost,
          },
          update: {
            quantity: { increment: openingQty },
            totalValue: { increment: openingQty * unitCost },
          },
        });

        // ปิดสมุดฝั่งเมนูด้วย ADJUST ลงศูนย์ — ไม่ใช่ลบทิ้ง ประวัติต้องอ่านย้อนได้ว่าของไปไหน
        await tx.menuItemStockMovement.create({
          data: {
            tenantId,
            menuItemId: menuItem.id,
            type: 'ADJUST',
            quantity: -openingQty,
            balanceAfter: 0,
            unitCost: menuItem.cost ?? undefined,
            referenceType: 'menu_promotion',
            referenceId: inventoryItem.id,
            note: `ย้ายเข้าคลังกลาง ${openingQty} หน่วย (คลัง ${warehouseId})`,
            createdBy: userId ?? 'system',
          },
        });
      }

      await tx.menuItem.update({
        where: { id: menuItem.id },
        data: { inventoryItemId: inventoryItem.id, trackStock: false, stockQty: 0 },
      });

      return { inventoryItem, movedQty: openingQty };
    });

    this.logger.log(
      `Promoted menu item ${menuItem.id} to inventory item ${result.inventoryItem.id} (${result.movedQty} units into warehouse ${warehouseId})`,
    );

    return {
      inventoryItemId: result.inventoryItem.id,
      sku: result.inventoryItem.sku,
      warehouseId,
      movedQty: result.movedQty,
      mode: 'CENTRAL' as const,
    };
  }

  /**
   * ถอดเมนูออกจากคลังกลาง กลับมานับในตัวเมนูเอง (ระดับ 2 → ระดับ 1)
   *
   * เดิมปุ่ม "ยกเลิกการเชื่อม" แค่ล้าง inventoryItemId ทิ้ง ผลคือของยังค้างอยู่ในคลัง
   * ส่วนเมนูเงียบ ๆ กลายเป็น "ขายไม่จำกัด" — ยอดที่เคยกันขายเกินให้หายไปทั้งก้อน
   * โดยไม่มีอะไรบอก การย้ายขึ้นมีทางเดินที่ไม่ทำของหาย การย้ายลงก็ต้องมีเหมือนกัน
   *
   * ต่างจาก promote ตรงที่ **ไม่บังคับว่าต้องมี INVENTORY_MODULE**: สิทธิ์ที่หมดอายุ
   * ห้ามขังเมนูไว้ในโหมดที่เจ้าของกิจการออกไม่ได้ ทางออกจากคลังกลางต้องเปิดเสมอ
   */
  async demote(
    restaurantId: string,
    menuItemId: string,
    dto: DemoteFromInventoryDto,
    tenantId: string,
    userId?: string,
  ) {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: { id: true, name: true, inventoryItemId: true },
    });
    if (!menuItem) {
      throw new NotFoundException(`Menu item ${menuItemId} not found`);
    }
    const inventoryItemId = menuItem.inventoryItemId;
    if (!inventoryItemId) {
      throw new ConflictException('เมนูนี้ไม่ได้ผูกกับสินค้าในคลังอยู่แล้ว');
    }

    const returnStock = dto.returnStock !== false;
    const warehouseId = returnStock
      ? await this.resolveReturnWarehouseId(restaurantId, tenantId, inventoryItemId, dto.warehouseId)
      : null;

    const { quantity, unitCost, valueOut } = returnStock
      ? await this.resolveReturn(tenantId, menuItem.id, inventoryItemId, warehouseId, dto.quantity)
      : { quantity: 0, unitCost: 0, valueOut: 0 };

    await this.prisma.$transaction(async (tx) => {
      if (quantity > 0 && warehouseId) {
        // เบิกออกจากคลังด้วยใบเบิกจริง ไม่ใช่แก้ยอดเงียบ ๆ — สมุดเคลื่อนไหว
        // ต้องอ่านย้อนได้ว่าของหายจากคลังไปอยู่ที่เมนูตั้งแต่เมื่อไหร่
        await tx.stockMovement.create({
          data: {
            tenantId,
            warehouseId,
            itemId: inventoryItemId,
            type: 'GOODS_ISSUE',
            quantity,
            unitCost,
            totalCost: valueOut,
            referenceType: 'menu_demotion',
            referenceId: menuItem.id,
            notes: `คืนยอดกลับไปนับที่เมนู "${menuItem.name}"`,
            createdBy: userId ?? 'system',
          },
        });

        await tx.warehouseStock.update({
          where: { warehouseId_itemId: { warehouseId, itemId: inventoryItemId } },
          data: {
            quantity: { decrement: quantity },
            totalValue: { decrement: valueOut },
          },
        });

        await tx.menuItemStockMovement.create({
          data: {
            tenantId,
            menuItemId: menuItem.id,
            type: 'OPENING',
            quantity,
            balanceAfter: quantity,
            unitCost: unitCost > 0 ? unitCost : undefined,
            referenceType: 'menu_demotion',
            referenceId: inventoryItemId,
            note: `รับยอดกลับจากคลังกลาง ${quantity} หน่วย (คลัง ${warehouseId})`,
            createdBy: userId ?? 'system',
          },
        });
      }

      await tx.menuItem.update({
        where: { id: menuItem.id },
        data: {
          inventoryItemId: null,
          // ดึงของกลับมาแล้วต้องนับต่อทันที ไม่งั้นของโผล่มาในเมนูที่ขายไม่จำกัด
          trackStock: returnStock,
          stockQty: quantity,
        },
      });
    });

    this.logger.log(
      `Demoted menu item ${menuItem.id} from inventory item ${inventoryItemId} (${quantity} units back from warehouse ${warehouseId ?? 'none'})`,
    );

    return {
      menuItemId: menuItem.id,
      inventoryItemId,
      warehouseId,
      movedQty: quantity,
      mode: (returnStock ? 'LOCAL' : 'UNTRACKED') as 'LOCAL' | 'UNTRACKED',
    };
  }

  /**
   * คลังที่จะดึงของกลับ — ต้องเป็นใบเดียวกับที่ตอนขายไปตัด ไม่งั้นดึงจากคลังที่
   * ไม่เคยมีของแล้วยอดติดลบขึ้นมาเฉย ๆ ทั้งที่ผู้ใช้แค่กดถอดการเชื่อม
   */
  private async resolveReturnWarehouseId(
    restaurantId: string,
    tenantId: string,
    inventoryItemId: string,
    requested?: string,
  ): Promise<string | null> {
    if (requested) {
      const chosen = await this.prisma.warehouse.findFirst({
        where: { id: requested, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!chosen) {
        throw new BadRequestException('ไม่พบคลังที่เลือก หรือคลังถูกปิดใช้งานแล้ว');
      }
      return chosen.id;
    }
    return this.sourceWarehouse.resolveForItem(tenantId, restaurantId, inventoryItemId);
  }

  /**
   * จำนวนที่ดึงกลับได้จริง พร้อมมูลค่าที่ต้องหักออกจากคลังไปด้วย
   *
   * ระบุมาเองก็ต้องไม่เกินของที่มี — ดึงเกินคือทำให้คลังติดลบด้วยการกดปุ่มเดียว
   * ไม่ระบุมาแปลว่า "เอาทั้งหมด" ยกเว้นกรณีที่มีเมนูอื่นผูกสินค้าตัวเดียวกันอยู่:
   * ตรงนั้นระบบเดาแทนไม่ได้ว่าใครควรได้เท่าไร ต้องให้คนตัดสิน
   *
   * ต้นทุนต่อหน่วยต้องมาจากมูลค่าที่คลังถือไว้เอง ไม่ใช่ช่อง cost ของเมนู ซึ่ง
   * ตามจริงแทบไม่มีใครกรอก — ยึดตามเมนูแล้วของออกจากคลังแต่มูลค่าไม่ลด คลังจะ
   * เหลือของน้อยลงโดยที่ยอดเงินเท่าเดิม แล้วรายงานมูลค่าคลังก็เพี้ยนถาวร
   *
   * ดึงออกหมดเมื่อไหร่ก็หักมูลค่าที่เหลือทั้งก้อน ไม่ใช่คูณกลับ — กันเศษทศนิยม
   * ค้างเป็นคลังที่ของเหลือศูนย์ชิ้นแต่ยังมีมูลค่าติดอยู่
   */
  private async resolveReturn(
    tenantId: string,
    menuItemId: string,
    inventoryItemId: string,
    warehouseId: string | null,
    requested?: number,
  ): Promise<{ quantity: number; unitCost: number; valueOut: number }> {
    if (!warehouseId) {
      if (requested && requested > 0) {
        throw new BadRequestException('ไม่พบคลังต้นทางของสินค้านี้ จึงดึงยอดกลับไม่ได้');
      }
      return { quantity: 0, unitCost: 0, valueOut: 0 };
    }

    const stock = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId, itemId: inventoryItemId, item: { tenantId } },
      select: { quantity: true, reservedQty: true, totalValue: true, avgCost: true },
    });
    const onHand = stock?.quantity ?? 0;
    const totalValue = Number(stock?.totalValue ?? 0);
    const unitCost = onHand > 0 ? totalValue / onHand : Number(stock?.avgCost ?? 0);
    const available = Math.max(onHand - (stock?.reservedQty ?? 0), 0);

    const withValue = (quantity: number) => ({
      quantity,
      unitCost,
      valueOut:
        quantity >= onHand ? Math.max(totalValue, 0) : Math.round(quantity * unitCost * 100) / 100,
    });

    if (requested !== undefined) {
      if (requested > available) {
        throw new BadRequestException(
          `คลังมีของเหลือ ${available} หน่วย ดึงกลับ ${requested} หน่วยไม่ได้`,
        );
      }
      return withValue(requested);
    }

    const sharedWith = await this.prisma.menuItem.count({
      where: { tenantId, inventoryItemId, id: { not: menuItemId } },
    });
    if (sharedWith > 0) {
      throw new BadRequestException(
        `มีเมนูอื่นอีก ${sharedWith} รายการที่ผูกสินค้าตัวนี้อยู่ — ระบุจำนวนที่จะดึงกลับมาเอง`,
      );
    }

    return withValue(available);
  }

  /** RTL-YYYYMM-NNNN — เลขต่อ tenant ออกจาก document_sequences ไม่ใช่การนับแถว */
  private async nextSku(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'RETAIL_SKU', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'RETAIL_SKU', prefix: 'RTL', yearMonth, lastNumber: 1 },
    });
    return `RTL-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * คลังปลายทางของการย้ายเข้าคลัง
   *
   * ถ้าผู้ใช้ระบุคลังมาเองต้องใช้ตัวนั้นเท่านั้น — เลือกคลังที่ปิดอยู่แล้วเงียบ ๆ
   * ไปวางของที่คลังอื่นแทน คือการย้ายของไปที่ที่เขาไม่ได้สั่ง
   *
   * ไม่ระบุมาก็ไล่ลำดับสำรองด้วยตัวเดียวกับที่ตอนปิดบิลใช้หาคลังไปตัด
   * ถ้าสองที่นี้ตอบไม่ตรงกัน ของจะไปกองอยู่ในคลังที่ตัวตัดไม่เคยมองหา
   */
  private async resolveWarehouseId(
    restaurantId: string,
    tenantId: string,
    requested?: string,
  ): Promise<string | null> {
    if (requested) {
      const chosen = await this.prisma.warehouse.findFirst({
        where: { id: requested, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (!chosen) {
        throw new BadRequestException('ไม่พบคลังที่เลือก หรือคลังถูกปิดใช้งานแล้ว');
      }
      return chosen.id;
    }

    return this.sourceWarehouse.resolve(tenantId, restaurantId);
  }
}
