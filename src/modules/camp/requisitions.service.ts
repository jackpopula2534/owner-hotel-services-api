import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { StockMovementsService } from '../inventory/stock-movements/stock-movements.service';
import { StockMovementTypeDto } from '../inventory/stock-movements/dto/create-stock-movement.dto';
import {
  CreateCampRequisitionDto,
  CreateCampRequisitionItemDto,
} from './dto/requisition.dto';

type RequisitionLineWithAddon = CreateCampRequisitionItemDto & {
  addonId?: string;
};

/**
 * ใบเบิก/ใบโอนของจากคลังกลาง (Inventory Module) → ลานแคมป์
 * - type=transfer : โอนเข้าคลังย่อยของลาน (TRANSFER_OUT/IN) ต้องเชื่อมคลังกลางก่อน
 * - type=issue    : เบิกออกจากคลังต้นทาง (GOODS_ISSUE) เข้าลานเป็น operational stock
 * ทั้งสองแบบจะเติม stockQty ให้ CampAddon ที่ผูกไว้ (ถ้ามี)
 */
@Injectable()
export class RequisitionsService {
  private readonly logger = new Logger(RequisitionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovements: StockMovementsService,
    private readonly integrations: IntegrationsService,
  ) {}

  async findAll(campgroundId: string | undefined, tenantId?: string) {
    if (!tenantId) {
      return { success: true, data: [] };
    }
    const data = await this.prisma.campRequisition.findMany({
      where: {
        tenantId,
        ...(campgroundId ? { campgroundId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const data = await this.prisma.campRequisition.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { items: true },
    });
    if (!data) {
      throw new NotFoundException(`Requisition ${id} not found`);
    }
    return { success: true, data };
  }

  async create(
    dto: CreateCampRequisitionDto,
    tenantId?: string,
    userId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('ต้องระบุ tenant');
    }
    // Integration Hub gate — creating requisitions moves stock in the central
    // warehouse, so the camp ↔ inventory connection must be switched on.
    const connected = await this.integrations.isEnabled(tenantId, 'camp-inventory-requisition');
    if (!connected) {
      throw new BadRequestException(
        'การเชื่อมต่อ "เบิก/โอนของจากคลังกลางไปลานแคมป์" ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า → การเชื่อมต่อระบบ',
      );
    }
    const campground = await this.prisma.campground.findFirst({
      where: { id: dto.campgroundId, tenantId },
    });
    if (!campground) {
      throw new NotFoundException(`Campground ${dto.campgroundId} not found`);
    }

    const source = await this.prisma.warehouse.findFirst({
      where: { id: dto.sourceWarehouseId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!source) {
      throw new BadRequestException('ไม่พบคลังต้นทางที่ระบุ');
    }

    let destWarehouseId: string | null = null;
    if (dto.type === 'transfer') {
      if (!campground.warehouseId) {
        throw new BadRequestException(
          'ต้องเชื่อมคลังกลางให้ลานนี้ก่อน จึงจะสร้างใบโอนได้',
        );
      }
      if (campground.warehouseId === dto.sourceWarehouseId) {
        throw new BadRequestException('คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน');
      }
      destWarehouseId = campground.warehouseId;
    }

    const requisitionNo = await this.generateNo(tenantId, dto.type);

    const preparedItems = await this.prepareRequisitionItems(
      tenantId,
      dto.campgroundId,
      dto.sourceWarehouseId,
      dto.items,
    );

    const created = await this.prisma.campRequisition.create({
      data: {
        tenantId,
        campgroundId: dto.campgroundId,
        requisitionNo,
        type: dto.type,
        sourceWarehouseId: dto.sourceWarehouseId,
        destWarehouseId,
        status: 'draft',
        notes: dto.notes ?? null,
        createdBy: userId ?? null,
        items: {
          create: preparedItems.map((it) => ({
            inventoryItemId: it.inventoryItemId,
            addonId: it.addonId ?? null,
            name: it.name,
            sku: it.sku ?? null,
            qty: it.qty,
            unitCost: it.unitCost ?? 0,
          })),
        },
      },
      include: { items: true },
    });
    return { success: true, data: created };
  }

  /** ยืนยันใบเบิก/ใบโอน → ดำเนินการเคลื่อนไหวสต็อกจริง + เติม stock ให้ addon */
  async confirm(id: string, tenantId?: string, userId?: string) {
    if (!tenantId || !userId) {
      throw new BadRequestException('ต้องระบุ tenant และผู้ใช้');
    }
    const req = await this.prisma.campRequisition.findFirst({
      where: { id, tenantId },
      include: { items: true, campground: { select: { name: true } } },
    });
    if (!req) {
      throw new NotFoundException(`Requisition ${id} not found`);
    }
    if (req.status !== 'draft') {
      throw new BadRequestException('ใบนี้ถูกดำเนินการไปแล้ว ไม่สามารถยืนยันซ้ำได้');
    }
    const campName = req.campground?.name ?? 'ลาน';
    const existingMovements = await this.prisma.stockMovement.count({
      where: {
        tenantId,
        referenceType: 'CAMP_REQUISITION',
        referenceId: req.id,
      },
    });
    if (existingMovements > 0) {
      const updated = await this.prisma.campRequisition.update({
        where: { id: req.id },
        data: { status: 'confirmed', confirmedAt: req.confirmedAt ?? new Date() },
        include: { items: true },
      });
      return { success: true, data: updated };
    }
    if (!req.items.length) {
      throw new BadRequestException('ใบนี้ไม่มีรายการสินค้า');
    }
    if (req.type === 'transfer' && !req.destWarehouseId) {
      throw new BadRequestException('ใบโอนไม่มีคลังปลายทาง');
    }
    // คลังปลายทางต้องยังมีอยู่จริง — กันกรณีลาน disconnect คลังกลางหลังสร้างใบนี้
    if (req.type === 'transfer' && req.destWarehouseId) {
      const dest = await this.prisma.warehouse.findFirst({
        where: { id: req.destWarehouseId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!dest) {
        throw new BadRequestException(
          'คลังปลายทางไม่พบ — ลานอาจถูกยกเลิกการเชื่อมคลังกลางหลังสร้างใบนี้',
        );
      }
    }

    // Pre-check: คลังต้นทางต้องมีของพอทุกบรรทัด (กัน partial-commit)
    for (const it of req.items) {
      const stock = await this.prisma.warehouseStock.findFirst({
        where: {
          warehouseId: req.sourceWarehouseId,
          itemId: it.inventoryItemId,
        },
        select: { quantity: true },
      });
      const available = stock?.quantity ?? 0;
      if (available < it.qty) {
        throw new BadRequestException(
          `สต็อกในคลังต้นทางไม่พอสำหรับ "${it.name}" (มี ${available} ต้องการ ${it.qty})`,
        );
      }
    }

    // Apply movements
    for (const it of req.items) {
      if (req.type === 'transfer') {
        await this.stockMovements.createTransfer(
          {
            fromWarehouseId: req.sourceWarehouseId,
            toWarehouseId: req.destWarehouseId as string,
            itemId: it.inventoryItemId,
            quantity: it.qty,
            referenceType: 'CAMP_REQUISITION',
            referenceId: req.id,
            notes: `โอนเข้าคลังลาน "${campName}" · ใบโอน ${req.requisitionNo}`,
          },
          userId,
          tenantId,
        );
      } else {
        const stock = await this.prisma.warehouseStock.findFirst({
          where: {
            warehouseId: req.sourceWarehouseId,
            itemId: it.inventoryItemId,
          },
          select: { avgCost: true },
        });
        await this.stockMovements.createMovement(
          {
            warehouseId: req.sourceWarehouseId,
            itemId: it.inventoryItemId,
            type: StockMovementTypeDto.GOODS_ISSUE,
            quantity: it.qty,
            unitCost: Number(stock?.avgCost ?? it.unitCost ?? 0),
            referenceType: 'CAMP_REQUISITION',
            referenceId: req.id,
            notes: `เบิกเข้าลาน "${campName}" · ใบเบิก ${req.requisitionNo}`,
          },
          userId,
          tenantId,
        );
      }

      // เติม stock ให้ addon ที่ผูกไว้; ใบเก่าที่ไม่มี addonId จะ auto-link/create ให้
      const addonId =
        it.addonId ??
        (await this.ensureAddonForInventoryItem({
          tenantId,
          campgroundId: req.campgroundId,
          inventoryItemId: it.inventoryItemId,
          sourceWarehouseId: req.sourceWarehouseId,
          name: it.name,
          sku: it.sku ?? undefined,
        }));

      if (addonId && !it.addonId) {
        await this.prisma.campRequisitionItem.update({
          where: { id: it.id },
          data: { addonId },
        });
      }

      if (addonId) {
        await this.prisma.campAddon.update({
          where: { id: addonId },
          data: { stockQty: { increment: it.qty } },
        });
      }
    }

    const updated = await this.prisma.campRequisition.update({
      where: { id },
      data: { status: 'confirmed', confirmedAt: new Date() },
      include: { items: true },
    });
    this.logger.log(
      `Requisition ${req.requisitionNo} confirmed (${req.type}, ${req.items.length} lines)`,
    );
    return { success: true, data: updated };
  }

  async cancel(id: string, tenantId?: string, userId?: string) {
    if (!tenantId || !userId) {
      throw new BadRequestException('ต้องระบุ tenant และผู้ใช้');
    }
    const req = await this.prisma.campRequisition.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!req) {
      throw new NotFoundException(`Requisition ${id} not found`);
    }
    if (req.status === 'confirmed') {
      await this.reverseConfirmedRequisition(req, tenantId, userId);
    }
    if (req.status === 'cancelled') {
      await this.reverseConfirmedRequisition(req, tenantId, userId);
    }
    if (!['draft', 'confirmed', 'cancelled'].includes(req.status)) {
      throw new BadRequestException('สถานะเอกสารนี้ไม่สามารถยกเลิกได้');
    }

    const data = await this.prisma.campRequisition.update({
      where: { id },
      data: { status: 'cancelled' },
      include: { items: true },
    });
    return { success: true, data };
  }

  private async generateNo(
    tenantId: string,
    type: 'issue' | 'transfer',
  ): Promise<string> {
    const prefix = type === 'transfer' ? 'TRF' : 'REQ';
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const count = await this.prisma.campRequisition.count({
      where: { tenantId, type },
    });
    return `${prefix}-${ym}-${String(count + 1).padStart(4, '0')}`;
  }

  private async reverseConfirmedRequisition(
    req: Awaited<ReturnType<typeof this.prisma.campRequisition.findFirst>> & {
      items: Array<{
        id: string;
        inventoryItemId: string;
        addonId: string | null;
        name: string;
        sku: string | null;
        qty: number;
        unitCost: unknown;
      }>;
    },
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const alreadyReversed = await this.prisma.stockMovement.count({
      where: {
        tenantId,
        referenceType: 'CAMP_REQUISITION_CANCEL',
        referenceId: req.id,
      },
    });
    if (alreadyReversed > 0) {
      return;
    }

    if (req.type === 'transfer' && !req.destWarehouseId) {
      throw new BadRequestException('ใบโอนไม่มีคลังปลายทางสำหรับย้อนรายการ');
    }

    const camp = await this.prisma.campground.findFirst({
      where: { id: req.campgroundId },
      select: { name: true },
    });
    const campName = camp?.name ?? 'ลาน';

    for (const it of req.items) {
      const unitCost = await this.resolveReversalUnitCost(
        req.destWarehouseId ?? req.sourceWarehouseId,
        req.sourceWarehouseId,
        it.inventoryItemId,
        Number(it.unitCost ?? 0),
      );

      if (req.type === 'transfer') {
        await this.stockMovements.createTransfer(
          {
            fromWarehouseId: req.destWarehouseId as string,
            toWarehouseId: req.sourceWarehouseId,
            itemId: it.inventoryItemId,
            quantity: it.qty,
            referenceType: 'CAMP_REQUISITION_CANCEL',
            referenceId: req.id,
            notes: `ยกเลิกใบโอน ${req.requisitionNo} · โอนคืนจากลาน "${campName}" กลับคลังต้นทาง`,
          },
          userId,
          tenantId,
        );
      } else {
        await this.stockMovements.createMovement(
          {
            warehouseId: req.sourceWarehouseId,
            itemId: it.inventoryItemId,
            type: StockMovementTypeDto.ADJUSTMENT_IN,
            quantity: it.qty,
            unitCost,
            referenceType: 'CAMP_REQUISITION_CANCEL',
            referenceId: req.id,
            notes: `ยกเลิกใบเบิก ${req.requisitionNo} · คืนของเข้าคลังต้นทาง (ลาน "${campName}")`,
          },
          userId,
          tenantId,
        );
      }

      if (it.addonId) {
        const addon = await this.prisma.campAddon.findFirst({
          where: { id: it.addonId, tenantId, campgroundId: req.campgroundId },
          select: { id: true, stockQty: true },
        });
        if (addon) {
          await this.prisma.campAddon.update({
            where: { id: addon.id },
            data: { stockQty: Math.max(0, addon.stockQty - it.qty) },
          });
        }
      }
    }
  }

  private async resolveReversalUnitCost(
    preferredWarehouseId: string,
    fallbackWarehouseId: string,
    itemId: string,
    fallbackCost: number,
  ): Promise<number> {
    const stock = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId: preferredWarehouseId, itemId },
      select: { avgCost: true },
    });
    if (stock) return Number(stock.avgCost ?? 0);

    const fallback = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId: fallbackWarehouseId, itemId },
      select: { avgCost: true },
    });
    return Number(fallback?.avgCost ?? fallbackCost ?? 0);
  }

  private async prepareRequisitionItems(
    tenantId: string,
    campgroundId: string,
    sourceWarehouseId: string,
    items: CreateCampRequisitionItemDto[],
  ): Promise<RequisitionLineWithAddon[]> {
    return Promise.all(
      items.map(async (item) => {
        const addonId = item.addonId
          ? await this.ensureExplicitAddonLink(
              tenantId,
              campgroundId,
              item.addonId,
              item.inventoryItemId,
              item.name,
            )
          : await this.ensureAddonForInventoryItem({
              tenantId,
              campgroundId,
              inventoryItemId: item.inventoryItemId,
              sourceWarehouseId,
              name: item.name,
              sku: item.sku,
            });

        return {
          ...item,
          addonId,
          unitCost:
            item.unitCost ??
            (await this.getSourceAvgCost(sourceWarehouseId, item.inventoryItemId)),
        };
      }),
    );
  }

  private async ensureExplicitAddonLink(
    tenantId: string,
    campgroundId: string,
    addonId: string,
    inventoryItemId: string,
    lineName: string,
  ): Promise<string> {
    const addon = await this.prisma.campAddon.findFirst({
      where: { id: addonId, tenantId, campgroundId },
      select: { id: true, inventoryItemId: true },
    });
    if (!addon) {
      throw new BadRequestException(
        `อุปกรณ์ที่ผูกกับ "${lineName}" ไม่อยู่ในลานนี้`,
      );
    }
    if (addon.inventoryItemId && addon.inventoryItemId !== inventoryItemId) {
      throw new BadRequestException(
        `อุปกรณ์ที่ผูกกับ "${lineName}" ไม่ตรงกับสินค้าในคลัง`,
      );
    }
    if (!addon.inventoryItemId) {
      await this.prisma.campAddon.update({
        where: { id: addon.id },
        data: { inventoryItemId },
      });
    }
    return addon.id;
  }

  private async ensureAddonForInventoryItem(params: {
    tenantId: string;
    campgroundId: string;
    inventoryItemId: string;
    sourceWarehouseId?: string;
    name: string;
    sku?: string;
  }): Promise<string | undefined> {
    const existing = await this.prisma.campAddon.findFirst({
      where: {
        tenantId: params.tenantId,
        campgroundId: params.campgroundId,
        inventoryItemId: params.inventoryItemId,
      },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id: params.inventoryItemId,
        tenantId: params.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        unit: true,
      },
    });
    if (!item) {
      throw new BadRequestException(
        `ไม่พบสินค้าในคลังสำหรับรายการ "${params.name}"`,
      );
    }

    const matchedByNameOrSku = await this.prisma.campAddon.findFirst({
      where: {
        tenantId: params.tenantId,
        campgroundId: params.campgroundId,
        inventoryItemId: null,
        OR: [{ name: item.name }, ...(item.sku ? [{ name: item.sku }] : [])],
      },
      select: { id: true },
    });
    if (matchedByNameOrSku) {
      await this.prisma.campAddon.update({
        where: { id: matchedByNameOrSku.id },
        data: { inventoryItemId: item.id },
      });
      return matchedByNameOrSku.id;
    }

    const sourceAvgCost = params.sourceWarehouseId
      ? await this.getSourceAvgCost(params.sourceWarehouseId, item.id)
      : 0;

    const created = await this.prisma.campAddon.create({
      data: {
        tenantId: params.tenantId,
        campgroundId: params.campgroundId,
        inventoryItemId: item.id,
        name: item.name,
        category: this.inferAddonCategory(item.sku, item.name),
        description:
          item.description ??
          `สร้างอัตโนมัติจากระบบคลัง (${item.sku || item.id})`,
        pricePerUnit: this.estimateRentalPrice(sourceAvgCost),
        unit: this.toThaiUnit(String(item.unit ?? 'PIECE')),
        stockQty: 0,
        active: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async getSourceAvgCost(
    warehouseId: string,
    itemId: string,
  ): Promise<number> {
    const stock = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId, itemId },
      select: { avgCost: true },
    });
    return Number(stock?.avgCost ?? 0);
  }

  private inferAddonCategory(sku?: string | null, name?: string | null): string {
    const text = `${sku ?? ''} ${name ?? ''}`.toLowerCase();
    if (text.includes('tent') || text.includes('เต็นท์')) return 'tent';
    if (
      text.includes('sleep') ||
      text.includes('mattress') ||
      text.includes('bed') ||
      text.includes('ถุงนอน') ||
      text.includes('ที่นอน') ||
      text.includes('หมอน')
    ) {
      return 'sleeping';
    }
    if (
      text.includes('cook') ||
      text.includes('stove') ||
      text.includes('ครัว') ||
      text.includes('เตา') ||
      text.includes('หม้อ') ||
      text.includes('กระทะ')
    ) {
      return 'cooking';
    }
    if (
      text.includes('firewood') ||
      text.includes('charcoal') ||
      text.includes('ฟืน') ||
      text.includes('ถ่าน')
    ) {
      return 'firewood';
    }
    if (
      text.includes('lamp') ||
      text.includes('lantern') ||
      text.includes('electric') ||
      text.includes('ไฟ') ||
      text.includes('ปลั๊ก')
    ) {
      return 'electric';
    }
    if (
      text.includes('tarp') ||
      text.includes('chair') ||
      text.includes('table') ||
      text.includes('cooler') ||
      text.includes('ผ้าใบ') ||
      text.includes('เก้าอี้') ||
      text.includes('โต๊ะ') ||
      text.includes('กระติก')
    ) {
      return 'gear';
    }
    return 'other';
  }

  private toThaiUnit(unit: string): string {
    const normalized = unit.toUpperCase();
    const map: Record<string, string> = {
      PIECE: 'ชิ้น',
      SET: 'ชุด',
      PACK: 'แพ็ค',
      BOX: 'กล่อง',
      BOTTLE: 'ขวด',
      KG: 'กก.',
      LITER: 'ลิตร',
      METER: 'เมตร',
    };
    return map[normalized] ?? unit;
  }

  private estimateRentalPrice(avgCost: number): number {
    if (!avgCost || avgCost <= 0) return 0;
    return Math.max(50, Math.ceil((avgCost * 0.15) / 10) * 10);
  }
}
