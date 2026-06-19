import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockMovementsService } from '../inventory/stock-movements/stock-movements.service';
import { StockMovementTypeDto } from '../inventory/stock-movements/dto/create-stock-movement.dto';
import { CreateCampRequisitionDto } from './dto/requisition.dto';

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
          create: dto.items.map((it) => ({
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
      include: { items: true },
    });
    if (!req) {
      throw new NotFoundException(`Requisition ${id} not found`);
    }
    if (req.status !== 'draft') {
      throw new BadRequestException('ใบนี้ถูกดำเนินการไปแล้ว ไม่สามารถยืนยันซ้ำได้');
    }
    if (!req.items.length) {
      throw new BadRequestException('ใบนี้ไม่มีรายการสินค้า');
    }
    if (req.type === 'transfer' && !req.destWarehouseId) {
      throw new BadRequestException('ใบโอนไม่มีคลังปลายทาง');
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
            notes: `Camp ${req.requisitionNo}`,
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
            notes: `Camp ${req.requisitionNo}`,
          },
          userId,
          tenantId,
        );
      }

      // เติม stock ให้ addon ที่ผูกไว้
      if (it.addonId) {
        await this.prisma.campAddon.update({
          where: { id: it.addonId },
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

  async cancel(id: string, tenantId?: string) {
    const req = await this.prisma.campRequisition.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, status: true },
    });
    if (!req) {
      throw new NotFoundException(`Requisition ${id} not found`);
    }
    if (req.status !== 'draft') {
      throw new BadRequestException('ยกเลิกได้เฉพาะใบที่ยังไม่ยืนยัน (draft)');
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
}
