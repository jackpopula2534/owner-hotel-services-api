import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, MenuStockMovementType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonService } from '../../addons/addon.service';
import { SourceWarehouseResolver } from '../../inventory/warehouses/source-warehouse.resolver';
import { WarehouseIssueService } from '../../inventory/warehouses/warehouse-issue.service';
import { MenuStockMovementDto } from './dto/menu-stock.dto';

/**
 * โหมดการนับสต๊อกของเมนูหนึ่งรายการ
 *
 * CENTRAL   — คลังกลางเป็นเจ้าของสต๊อก (ผูก inventoryItemId + tenant มี INVENTORY_MODULE)
 *             ตัวเลขไหลผ่าน stock_movements ของระบบคลัง ห้ามแก้ผ่านเมนู
 * LOCAL     — นับในตัวเมนูเอง (trackStock) สำหรับ tenant ที่ไม่ได้ซื้อ add-on คลัง
 * UNTRACKED — ขายได้ไม่จำกัด ไม่นับสต๊อก
 */
export type MenuStockMode = 'CENTRAL' | 'LOCAL' | 'UNTRACKED';

export interface MenuStockShape {
  inventoryItemId?: string | null;
  trackStock?: boolean;
}

/**
 * ตัดสินโหมดสต๊อกจากตัวเมนู + สิทธิ์ที่ tenant ถืออยู่ — ตรรกะนี้ต้องอยู่ที่เดียว
 *
 * เคสที่ต้องระวังที่สุด: tenant เคยผูกคลังกลางไว้แล้ว **add-on คลังหมดอายุ**
 * ต้องตกไป UNTRACKED (ขายต่อได้) ห้ามตกไป LOCAL เพราะ stockQty ท้องถิ่นเป็น 0
 * แล้วจะขายไม่ได้เลย — สิทธิ์ที่หมดไปห้ามกั้นการขายของ
 */
export function resolveStockMode(item: MenuStockShape, hasInventoryAddon: boolean): MenuStockMode {
  if (item.inventoryItemId) return hasInventoryAddon ? 'CENTRAL' : 'UNTRACKED';
  if (item.trackStock) return 'LOCAL';
  return 'UNTRACKED';
}

/** ทิศทางของแต่ละชนิดรายการ — ADJUST คิดแยกเพราะ quantity ที่ส่งมาคือ "ยอดนับจริง" */
const MOVEMENT_SIGN: Record<Exclude<MenuStockMovementType, 'ADJUST'>, 1 | -1> = {
  OPENING: 1,
  RECEIVE: 1,
  RETURN: 1,
  SALE: -1,
  WASTE: -1,
};

@Injectable()
export class MenuStockService {
  private readonly logger = new Logger(MenuStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
    private readonly sourceWarehouse: SourceWarehouseResolver,
    private readonly warehouseIssue: WarehouseIssueService,
  ) {}

  async hasInventoryAddon(tenantId: string): Promise<boolean> {
    try {
      return await this.addonService.hasActiveAddon(tenantId, 'INVENTORY_MODULE');
    } catch (error) {
      // สิทธิ์อ่านไม่ได้ต้องไม่ทำให้ขายของไม่ได้ — ถือว่าไม่มี add-on แล้วปล่อยผ่าน
      this.logger.warn(`Addon lookup failed for tenant ${tenantId}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * กันขายเกินสต๊อกตั้งแต่ตอนเพิ่มลงบิล
   *
   * นับของที่ค้างอยู่ในบิลอื่นที่ยังไม่ปิดด้วย ไม่งั้นสองโต๊ะจองขวดสุดท้ายพร้อมกันได้
   * (สต๊อกตัดจริงตอนปิดบิล การจองล่วงหน้าเป็นแค่การกันชน)
   *
   * ต้องกันทั้ง LOCAL และ CENTRAL — เดิมกันแต่ LOCAL ผลคือยิ่งซื้อโมดูลคลัง
   * ยิ่งได้การป้องกันน้อยลง ของที่คลังเป็นเจ้าของยอดขายทะลุได้ไม่มีเตือน
   * รู้อีกทีตอนยอดในคลังติดลบไปแล้ว
   *
   * จุดที่กันคือ "ตอนเพิ่มลงบิล" ซึ่งยังไม่ได้สัญญากับลูกค้า ต่างจากตอนปิดบิลที่
   * ของออกจากมือไปแล้ว — ตรงนั้นยังต้องยอมให้ติดลบพร้อม shortfallQty ตามเดิม
   * เพราะปฏิเสธการบันทึกคือทำยอดขายหาย
   */
  async assertCanSell(tenantId: string, menuItemId: string, quantity: number): Promise<void> {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      select: {
        id: true,
        name: true,
        trackStock: true,
        stockQty: true,
        inventoryItemId: true,
        restaurantId: true,
      },
    });
    if (!item) return; // ให้ผู้เรียกเป็นคนโยน NotFound เอง

    const mode = resolveStockMode(item, await this.hasInventoryAddon(tenantId));
    if (mode === 'UNTRACKED') return;

    if (mode === 'LOCAL') {
      const reserved = await this.reservedQty(tenantId, { menuItemId });
      this.assertEnough(item.name, item.stockQty, reserved, quantity);
      return;
    }

    await this.assertCentralStock(tenantId, item, quantity);
  }

  /**
   * ยอดคงเหลือของโหมด CENTRAL อยู่ที่คลัง — ต้องอ่านจากคลังใบเดียวกับที่ตอนปิดบิล
   * จะไปหักออก ไม่งั้นกันไว้ที่คลังหนึ่งแล้วไปตัดอีกคลังหนึ่ง
   *
   * อ่านคลังไม่ได้ต้องปล่อยขาย ไม่ใช่กั้นทั้งร้าน — ระบบคลังล่มห้ามลามมาเป็น
   * "ขายอะไรไม่ได้เลย" ที่หน้าเคาน์เตอร์
   */
  private async assertCentralStock(
    tenantId: string,
    item: { name: string; inventoryItemId: string | null; restaurantId: string },
    quantity: number,
  ): Promise<void> {
    if (!item.inventoryItemId) return;

    let onHand: number;
    let reserved: number;
    try {
      const warehouseId = await this.sourceWarehouse.resolveForItem(
        tenantId,
        item.restaurantId,
        item.inventoryItemId,
      );
      if (!warehouseId) return; // ไม่มีคลังให้เทียบ ก็ไม่มีข้อมูลพอจะบอกว่าขายเกิน

      // findFirst + เช็ค tenant ของสินค้าด้วย ไม่ใช่ findUnique เฉย ๆ — inventoryItemId
      // ที่ค้างอยู่ผิดกิจการจะได้ไม่ไปอ่านยอดคงเหลือของคนอื่นมาตอบ
      const stock = await this.prisma.warehouseStock.findFirst({
        where: {
          warehouseId,
          itemId: item.inventoryItemId,
          item: { tenantId },
        },
        select: { quantity: true, reservedQty: true },
      });
      // reservedQty คือของที่คลังกันไว้ให้งานอื่นแล้ว (เช่น เบิกให้พนักงานใหม่)
      // ไม่ใช่ของที่หน้าร้านหยิบขายได้
      onHand = stock ? stock.quantity - stock.reservedQty : 0;

      // จองข้ามเมนูในร้านเดียวกันที่ผูกสินค้าตัวเดียวกัน — ร้านหนึ่งมีได้หลายเมนู
      // ที่ชี้ไปที่น้ำขวดเดียวกัน (เช่น "น้ำเปล่า" กับ "น้ำเปล่า (แถม)")
      //
      // จงใจไม่นับข้ามร้าน: ร้านอื่นอาจตัดจากคลังคนละใบ การเหมานับจะกันการขาย
      // ทั้งที่ของยังมี ซึ่งแย่กว่าการกันไม่ครบ (กันไม่ครบยังมี shortfallQty รับไว้)
      reserved = await this.reservedQty(tenantId, {
        restaurantId: item.restaurantId,
        inventoryItemId: item.inventoryItemId,
      });
    } catch (error) {
      this.logger.warn(
        `Central stock check failed for menu item ${item.name} (tenant ${tenantId}): ${(error as Error).message}`,
      );
      return;
    }

    this.assertEnough(item.name, onHand, reserved, quantity);
  }

  private assertEnough(
    name: string,
    onHand: number,
    reserved: number,
    quantity: number,
  ): void {
    const available = onHand - reserved;
    if (quantity > available) {
      throw new ConflictException(
        `"${name}" คงเหลือไม่พอ (เหลือ ${Math.max(available, 0)} ในสต๊อก${
          reserved > 0 ? `, ค้างในบิลที่ยังไม่ปิด ${reserved}` : ''
        })`,
      );
    }
  }

  /**
   * จำนวนที่ถูกจองไว้ในบิลที่ยังไม่ปิด/ไม่ยกเลิก (ยังไม่ได้ตัดสต๊อกจริง)
   *
   * โหมด LOCAL จองเป็นรายเมนู ส่วน CENTRAL จองเป็นรายสินค้าในคลัง เพราะหลายเมนู
   * กินยอดของสินค้าตัวเดียวกัน
   */
  private async reservedQty(
    tenantId: string,
    scope:
      | { menuItemId: string }
      | { restaurantId: string; inventoryItemId: string },
  ): Promise<number> {
    const agg = await this.prisma.orderItem.aggregate({
      where: {
        tenantId,
        ...('menuItemId' in scope
          ? { menuItemId: scope.menuItemId }
          : {
              menuItem: {
                tenantId,
                restaurantId: scope.restaurantId,
                inventoryItemId: scope.inventoryItemId,
              },
            }),
        status: { not: 'CANCELLED' },
        // บรรทัดที่หักออกจากสต๊อกไปแล้ว (ของสำเร็จรูปที่ตัดตอนสั่ง) ไม่ต้องนับซ้ำ
        // ยอดคงเหลือที่อ่านมาลดไปแล้ว ถ้านับอีกรอบจะกลายเป็นกันของตัวเองสองเท่า
        // แล้วขึ้นว่า "คงเหลือไม่พอ" ทั้งที่ของยังอยู่ในตู้
        stockDeductedAt: null,
        order: {
          tenantId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  /**
   * ตัดสต๊อกโหมด LOCAL ตอนปิดบิล — ต้องเรียกใน transaction เดียวกับที่ปิดบิล
   *
   * เหลือไว้เป็น "ตาข่ายรับ" ของบรรทัดที่ยังไม่ถูกหักตอนสั่ง: บิลที่เปิดค้างไว้ก่อน
   * ระบบเปลี่ยนมาหักตอนสั่ง หรือบรรทัดที่ตอนสั่งหักไม่สำเร็จ (คลังตอบไม่ได้)
   *
   * ทำซ้ำไม่ได้เพราะประทับ `stockDeductedAt` ลงบรรทัดที่หักแล้ว — ปิดบิลผ่านการจ่ายเงิน
   * กับผ่าน updateStatus เรียกจุดเดียวกัน จึงมีโอกาสยิงซ้ำ
   *
   * ยอดติดลบได้ถ้าบิลสองใบขายขวดสุดท้ายพร้อมกัน — ตั้งใจให้ติดลบเพื่อให้เห็นว่า
   * ขายเกินไปเท่าไร ดีกว่าตัดแค่เท่าที่มีแล้วส่วนต่างหายเงียบ
   */
  async deductForOrder(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      orderId: string;
      items: { orderItemId?: string; menuItemId: string; quantity: number }[];
      userId?: string;
    },
  ): Promise<void> {
    const { tenantId, orderId, userId } = params;
    if (!params.items.length) return;

    // กันตัดซ้ำที่ระดับบรรทัด: บรรทัดที่ถูกประทับไปแล้ว (หักตอนสั่ง หรือปิดบิลรอบก่อน)
    // ต้องหลุดออกก่อนนับ ตัวกรองฝั่งผู้เรียกอ่านค่ามาก่อนเข้าทรานแซกชัน จึงเก่าได้
    const done = await this.alreadyDeducted(
      tx,
      params.items.map((i) => i.orderItemId).filter((id): id is string => !!id),
    );

    // รวมจำนวนต่อเมนู — บิลใบเดียวมีเมนูเดิมได้หลายบรรทัด
    const byMenuItem = new Map<string, number>();
    const lineIdsOf = new Map<string, string[]>();
    for (const line of params.items) {
      if (line.orderItemId && done.has(line.orderItemId)) continue;
      if (!line.menuItemId || line.quantity <= 0) continue;
      byMenuItem.set(line.menuItemId, (byMenuItem.get(line.menuItemId) ?? 0) + line.quantity);
      if (line.orderItemId) {
        lineIdsOf.set(line.menuItemId, [...(lineIdsOf.get(line.menuItemId) ?? []), line.orderItemId]);
      }
    }
    if (!byMenuItem.size) return;

    const tracked = await tx.menuItem.findMany({
      where: { id: { in: [...byMenuItem.keys()] }, tenantId, trackStock: true, inventoryItemId: null },
      select: { id: true, name: true, stockQty: true, cost: true },
    });

    const deductedLineIds: string[] = [];
    for (const item of tracked) {
      const qty = byMenuItem.get(item.id) ?? 0;
      if (qty <= 0) continue;

      await this.issueLocal(tx, {
        tenantId,
        orderId,
        item,
        quantity: qty,
        userId,
      });
      deductedLineIds.push(...(lineIdsOf.get(item.id) ?? []));
    }

    await this.stampDeducted(tx, deductedLineIds);
  }

  // ─── ตัดสต๊อกตอนสั่ง ────────────────────────────────────────────────────────

  /**
   * หักของสำเร็จรูปออกจากสต๊อกตั้งแต่ตอนที่บรรทัดถูกเพิ่มลงบิล
   *
   * ทำไมไม่รอปิดบิล: น้ำขวดถูกหยิบออกจากตู้ตอนพนักงานรับออร์เดอร์ ไม่ใช่ตอนโต๊ะจ่ายเงิน
   * บิลโต๊ะหนึ่งเปิดค้างได้เป็นชั่วโมง ระหว่างนั้นยอดที่หน้าจอกับของในตู้ไม่ตรงกัน
   * ใครมาเช็คสต๊อกกลางวันก็เห็นตัวเลขที่ไม่มีอยู่จริง
   *
   * ของปรุงตามสูตรยังตัดตอนปิดบิลเหมือนเดิม — นั่นเป็นการ "ประมาณจากสูตร"
   * และมีสวิตช์ของตัวเองใน Integration Hub
   *
   * ห้ามโยน error ออกไป: หักไม่ได้ก็ยังต้องขายได้ บรรทัดที่ไม่ถูกประทับเวลาจะถูก
   * ตาข่ายตอนปิดบิลรับไปหักต่อ
   */
  async deductPlacedLines(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      restaurantId: string;
      orderId: string;
      lines: { orderItemId: string; menuItemId: string; quantity: number }[];
      userId?: string;
    },
  ): Promise<void> {
    const { tenantId, restaurantId, orderId, userId } = params;
    const lines = params.lines.filter((l) => l.menuItemId && l.quantity > 0);
    if (!lines.length) return;

    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: [...new Set(lines.map((l) => l.menuItemId))] }, tenantId },
      select: {
        id: true,
        name: true,
        trackStock: true,
        stockQty: true,
        cost: true,
        inventoryItemId: true,
        restaurantId: true,
        inventoryItem: { select: { name: true } },
      },
    });
    if (!menuItems.length) return;

    const hasAddon = await this.hasInventoryAddon(tenantId);
    const stamped: string[] = [];

    for (const menuItem of menuItems) {
      const qty = lines
        .filter((l) => l.menuItemId === menuItem.id)
        .reduce((sum, l) => sum + l.quantity, 0);
      if (qty <= 0) continue;

      const mode = resolveStockMode(menuItem, hasAddon);
      if (mode === 'UNTRACKED') continue;

      const lineIds = lines.filter((l) => l.menuItemId === menuItem.id).map((l) => l.orderItemId);

      if (mode === 'LOCAL') {
        await this.issueLocal(tx, { tenantId, orderId, item: menuItem, quantity: qty, userId });
        stamped.push(...lineIds);
        continue;
      }

      const warehouseId = await this.resolveCentralWarehouse(tenantId, restaurantId, menuItem);
      // ไม่รู้ว่าจะหักจากคลังไหนก็อย่าเดา — ปล่อยให้เป็นของที่ "กันไว้" ตามเดิม
      // แล้วไปหักตอนปิดบิล ดีกว่าหักผิดคลังจนยอดเพี้ยนสองใบพร้อมกัน
      if (!warehouseId || !menuItem.inventoryItemId) continue;

      await this.warehouseIssue.issue(tx, {
        tenantId,
        warehouseId,
        itemId: menuItem.inventoryItemId,
        quantity: qty,
        referenceType: 'restaurant_order',
        referenceId: orderId,
        notes: `ตัดตอนสั่ง: ${menuItem.inventoryItem?.name ?? menuItem.name} x${qty} (บิล ${orderId})`,
        createdBy: userId ?? 'system',
        label: menuItem.name,
      });
      stamped.push(...lineIds);
    }

    await this.stampDeducted(tx, stamped, new Date());
  }

  /**
   * คืนของกลับเข้าสต๊อกเมื่อบรรทัดที่หักไปแล้วถูกยกเลิก/ลบทิ้ง
   *
   * ต้องเรียกก่อนลบแถวออก ไม่งั้นจะไม่เหลือข้อมูลว่าต้องคืนอะไรเท่าไร
   * บรรทัดที่ยังไม่เคยถูกหัก (stockDeductedAt ว่าง) ต้องไม่คืน — ไม่งั้นของงอกจากอากาศ
   */
  async returnPlacedLines(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      restaurantId: string;
      orderId: string;
      orderItemIds?: string[];
      userId?: string;
    },
  ): Promise<void> {
    const { tenantId, restaurantId, orderId, userId } = params;
    const deducted = await tx.orderItem.findMany({
      where: {
        orderId,
        stockDeductedAt: { not: null },
        ...(params.orderItemIds ? { id: { in: params.orderItemIds } } : {}),
      },
      select: { id: true, menuItemId: true, quantity: true },
    });
    if (!deducted.length) return;

    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: [...new Set(deducted.map((l) => l.menuItemId))] }, tenantId },
      select: {
        id: true,
        name: true,
        stockQty: true,
        cost: true,
        trackStock: true,
        inventoryItemId: true,
        restaurantId: true,
        inventoryItem: { select: { name: true } },
      },
    });

    const hasAddon = await this.hasInventoryAddon(tenantId);
    const cleared: string[] = [];

    for (const menuItem of menuItems) {
      const rows = deducted.filter((l) => l.menuItemId === menuItem.id);
      const qty = rows.reduce((sum, l) => sum + l.quantity, 0);
      if (qty <= 0) continue;

      const mode = resolveStockMode(menuItem, hasAddon);
      if (mode === 'LOCAL') {
        const balanceAfter = menuItem.stockQty + qty;
        await tx.menuItem.update({ where: { id: menuItem.id }, data: { stockQty: balanceAfter } });
        await tx.menuItemStockMovement.create({
          data: {
            tenantId,
            menuItemId: menuItem.id,
            type: 'RETURN',
            quantity: qty,
            balanceAfter,
            unitCost: menuItem.cost ?? undefined,
            referenceType: 'restaurant_order',
            referenceId: orderId,
            note: `ยกเลิกรายการที่หักไปแล้ว — คืนเข้าสต๊อก ${qty}`,
            createdBy: userId ?? 'system',
          },
        });
        cleared.push(...rows.map((r) => r.id));
        continue;
      }

      if (mode === 'UNTRACKED' || !menuItem.inventoryItemId) continue;

      const warehouseId = await this.resolveCentralWarehouse(tenantId, restaurantId, menuItem);
      if (!warehouseId) continue;

      await this.warehouseIssue.returnToStock(tx, {
        tenantId,
        warehouseId,
        itemId: menuItem.inventoryItemId,
        quantity: qty,
        referenceType: 'restaurant_order',
        referenceId: orderId,
        notes: `ยกเลิกรายการที่หักไปแล้ว: ${menuItem.inventoryItem?.name ?? menuItem.name} x${qty} (บิล ${orderId})`,
        createdBy: userId ?? 'system',
      });
      cleared.push(...rows.map((r) => r.id));
    }

    await this.stampDeducted(tx, cleared, null);
  }

  /** ตัดสต๊อกที่นับอยู่ในตัวเมนูเอง (โหมด LOCAL) + เขียนสมุดของเมนู */
  private async issueLocal(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      orderId: string;
      item: { id: string; name: string; stockQty: number; cost: Prisma.Decimal | null };
      quantity: number;
      userId?: string;
    },
  ): Promise<void> {
    const { tenantId, orderId, item, quantity, userId } = params;
    const balanceAfter = item.stockQty - quantity;
    const oversold = balanceAfter < 0 ? -balanceAfter : 0;

    await tx.menuItem.update({ where: { id: item.id }, data: { stockQty: balanceAfter } });
    await tx.menuItemStockMovement.create({
      data: {
        tenantId,
        menuItemId: item.id,
        type: 'SALE',
        quantity: -quantity,
        balanceAfter,
        unitCost: item.cost ?? undefined,
        referenceType: 'restaurant_order',
        referenceId: orderId,
        note: oversold > 0 ? `ขายเกินสต๊อก ${oversold} หน่วย — ต้องตรวจนับ` : undefined,
        createdBy: userId ?? 'system',
      },
    });

    if (oversold > 0) {
      this.logger.warn(
        `Oversold "${item.name}" by ${oversold} on order ${orderId} (tenant ${tenantId})`,
      );
    }
  }

  /**
   * คลังที่จะหักของชิ้นนี้ — ตัวเดียวกับที่ assertCanSell ใช้อ่านยอดมากันขายเกิน
   * อ่านไม่ได้ให้ตอบ null แล้วปล่อยผ่าน ระบบคลังล่มห้ามลามเป็นขายของไม่ได้
   */
  private async resolveCentralWarehouse(
    tenantId: string,
    restaurantId: string,
    item: { inventoryItemId: string | null; restaurantId: string; name: string },
  ): Promise<string | null> {
    if (!item.inventoryItemId) return null;
    try {
      return await this.sourceWarehouse.resolveForItem(
        tenantId,
        item.restaurantId || restaurantId,
        item.inventoryItemId,
      );
    } catch (error) {
      this.logger.warn(
        `Warehouse lookup failed for menu item ${item.name} (tenant ${tenantId}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** บรรทัดไหนถูกหักไปแล้วบ้าง — อ่านสดในทรานแซกชัน ไม่เชื่อค่าที่ผู้เรียกอ่านมาก่อนหน้า */
  private async alreadyDeducted(
    tx: Prisma.TransactionClient,
    orderItemIds: string[],
  ): Promise<Set<string>> {
    if (!orderItemIds.length) return new Set();
    const rows = await tx.orderItem.findMany({
      where: { id: { in: orderItemIds }, stockDeductedAt: { not: null } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** ประทับ (หรือลบ) เวลาที่บรรทัดถูกหักออกจากสต๊อก — ตัวชี้ขาดว่าหักไปแล้วหรือยัง */
  private async stampDeducted(
    tx: Prisma.TransactionClient,
    orderItemIds: string[],
    at: Date | null = new Date(),
  ): Promise<void> {
    if (!orderItemIds.length) return;
    await tx.orderItem.updateMany({
      where: { id: { in: orderItemIds } },
      data: { stockDeductedAt: at },
    });
  }

  // ─── รายการเข้า-ออกที่ทำด้วยมือ (รับของ / นับ / ตัดของเสีย) ─────────────────

  async applyMovement(
    restaurantId: string,
    menuItemId: string,
    dto: MenuStockMovementDto,
    tenantId: string,
    userId?: string,
  ) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: {
        id: true,
        name: true,
        trackStock: true,
        stockQty: true,
        inventoryItemId: true,
        itemKind: true,
      },
    });
    if (!item) {
      throw new NotFoundException(`Menu item ${menuItemId} not found`);
    }

    const mode = resolveStockMode(item, await this.hasInventoryAddon(tenantId));
    if (mode === 'CENTRAL') {
      throw new BadRequestException(
        'เมนูนี้ผูกกับคลังสินค้าแล้ว — ปรับจำนวนผ่านใบรับของ/ใบเบิกในระบบคลังเท่านั้น',
      );
    }
    if (mode === 'UNTRACKED') {
      throw new BadRequestException(
        'เมนูนี้ยังไม่ได้เปิดการนับสต๊อก — เปิด "นับสต๊อกในเมนูนี้" ก่อนจึงจะบันทึกรับของได้',
      );
    }

    if (dto.type === 'SALE') {
      throw new BadRequestException(
        'รายการขายถูกบันทึกอัตโนมัติตอนปิดบิล — ถ้าต้องการตัดออกเองให้ใช้ WASTE หรือ ADJUST',
      );
    }

    const { quantity: delta, balanceAfter } = this.resolveDelta(dto, item.stockQty);

    if (balanceAfter < 0) {
      throw new BadRequestException(
        `ยอดคงเหลือติดลบไม่ได้ — "${item.name}" มีอยู่ ${item.stockQty} แต่จะตัดออก ${Math.abs(delta)}`,
      );
    }

    const [, movement] = await this.prisma.$transaction([
      this.prisma.menuItem.update({ where: { id: menuItemId }, data: { stockQty: balanceAfter } }),
      this.prisma.menuItemStockMovement.create({
        data: {
          tenantId,
          menuItemId,
          type: dto.type,
          quantity: delta,
          balanceAfter,
          unitCost: dto.unitCost,
          referenceType: 'manual',
          note: dto.note,
          createdBy: userId ?? 'system',
        },
      }),
    ]);

    return { ...movement, stockQty: balanceAfter };
  }

  /**
   * ADJUST ใช้ `quantity` เป็น "ยอดที่นับได้จริง" ไม่ใช่ส่วนต่าง เพราะคนนับสต๊อก
   * กรอกยอดที่เห็นในตู้ ไม่ได้คิดส่วนต่างเอง — ที่เหลือคิดจากยอดปัจจุบันให้
   */
  private resolveDelta(dto: MenuStockMovementDto, current: number) {
    if (dto.type === 'ADJUST') {
      return { quantity: dto.quantity - current, balanceAfter: dto.quantity };
    }
    const delta = MOVEMENT_SIGN[dto.type] * dto.quantity;
    return { quantity: delta, balanceAfter: current + delta };
  }

  async listMovements(
    restaurantId: string,
    menuItemId: string,
    tenantId: string,
    limit = 50,
  ) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: { id: true, stockQty: true, trackStock: true, inventoryItemId: true },
    });
    if (!item) {
      throw new NotFoundException(`Menu item ${menuItemId} not found`);
    }

    const movements = await this.prisma.menuItemStockMovement.findMany({
      where: { menuItemId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });

    return {
      stockQty: item.stockQty,
      mode: resolveStockMode(item, await this.hasInventoryAddon(tenantId)),
      movements,
    };
  }
}
