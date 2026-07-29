import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  COST_EVENTS,
  StockMovementCreatedEvent,
} from '../cost-accounting/events/cost-accounting.events';

/** บรรทัดอุปกรณ์ใน items JSON ของ equipment request / issuance */
export interface EquipmentLine {
  name: string;
  qty: number;
  estimatedCost?: number | null;
  note?: string | null;
  itemId?: string | null; // ผูกกับ InventoryItem (มีเมื่อใช้ INVENTORY_MODULE)
  warehouseId?: string | null;
  reserved?: boolean;
  issued?: boolean;
  serialNo?: string | null;
  [key: string]: unknown;
}

export interface LineAvailability {
  index: number;
  itemId: string;
  available: number;
  sufficient: boolean;
}

/**
 * เชื่อม recruitment ↔ คลัง/จัดซื้อ (gate: Integration Hub 'hr-inventory-onboarding')
 * ทุก method เป็น graceful degradation — caller ต้องเช็ค isEnabled() ก่อน (double-gate)
 * และเมื่อ addon ไม่ active ฟีเจอร์หลักของ recruitment ต้องทำงานได้ตามเดิม
 */
@Injectable()
export class RecruitmentInventoryService {
  private readonly logger = new Logger(RecruitmentInventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    try {
      // Central gate = Integration Hub connection (its requiredAddons already
      // cover HR_MODULE + INVENTORY_MODULE), so tenants can switch this off
      // from ตั้งค่า → การเชื่อมต่อระบบ without losing the add-ons.
      return await this.integrations.isEnabled(tenantId, 'hr-inventory-onboarding');
    } catch (error) {
      this.logger.warn(
        `Integration check failed (treating as disabled): ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * เช็คสต๊อกคงเหลือ (หักจองแล้ว) ของบรรทัดที่ผูก itemId — ใช้แสดงป้าย 🟢มี/🔴ต้องสั่ง
   * บรรทัดที่ไม่ผูก itemId (checklist อิสระ) จะไม่อยู่ในผลลัพธ์
   */
  async checkAvailability(items: EquipmentLine[], tenantId: string): Promise<LineAvailability[]> {
    const result: LineAvailability[] = [];
    for (let index = 0; index < items.length; index++) {
      const line = items[index];
      if (!line?.itemId) continue;
      const available = await this.availableQty(this.prisma, tenantId, line.itemId, line.warehouseId ?? null);
      result.push({ index, itemId: line.itemId, available, sufficient: available >= line.qty });
    }
    return result;
  }

  /**
   * ออก PR อัตโนมัติสำหรับของที่ขาด (เรียกหลัง equipment request อนุมัติครบ)
   * department = แผนกที่ขอ (เจ้าของต้นทุน), จัดซื้อเป็นผู้จัดหา — คืนค่า PR ที่สร้าง หรือ null ถ้าของพอ
   */
  async createPrForShortage(equipmentRequestId: string, tenantId: string, userId: string): Promise<{ id: string; prNumber: string } | null> {
    const request = await (this.prisma as any).hrEquipmentRequest.findFirst({
      where: { id: equipmentRequestId, tenantId },
      include: { manpowerRequest: { select: { requestNo: true, propertyId: true, departmentId: true } } },
    });
    if (!request || request.purchaseRequisitionId) return null;

    const items: EquipmentLine[] = Array.isArray(request.items) ? request.items : [];
    const shortages: Array<{ itemId: string; quantity: number; estimatedUnitPrice: number | null; name: string }> = [];
    for (const line of items) {
      if (!line?.itemId) continue;
      const available = await this.availableQty(this.prisma, tenantId, line.itemId, line.warehouseId ?? null);
      const missing = line.qty - available;
      if (missing > 0) {
        shortages.push({
          itemId: line.itemId,
          quantity: missing,
          estimatedUnitPrice: line.estimatedCost ?? null,
          name: line.name,
        });
      }
    }
    if (!shortages.length) return null;

    const propertyId =
      request.manpowerRequest?.propertyId ??
      (await this.prisma.property.findFirst({ where: { tenantId }, select: { id: true } }))?.id;
    if (!propertyId) {
      this.logger.warn(`Cannot create PR for equipment request ${equipmentRequestId}: no property found`);
      return null;
    }

    const department = request.manpowerRequest?.departmentId
      ? (
          await (this.prisma as any).hrDepartment.findFirst({
            where: { id: request.manpowerRequest.departmentId, tenantId },
            select: { name: true },
          })
        )?.name ?? null
      : null;

    const pr = await this.prisma.$transaction(async (tx) => {
      const prNumber = await this.generateDocNumber(tx, tenantId, 'PURCHASE_REQUISITION', 'PR');
      const created = await tx.purchaseRequisition.create({
        data: {
          tenantId,
          propertyId,
          prNumber,
          status: 'DRAFT',
          priority: 'NORMAL',
          purpose: `อุปกรณ์พนักงานใหม่ — ${request.manpowerRequest?.requestNo ?? equipmentRequestId}`,
          department,
          notes: `Auto-created from HR equipment request (${shortages.map((s) => `${s.name} x${s.quantity}`).join(', ')})`,
          requestedBy: userId,
        },
      });
      await tx.purchaseRequisitionItem.createMany({
        data: shortages.map((s) => ({
          purchaseRequisitionId: created.id,
          itemId: s.itemId,
          quantity: s.quantity,
          estimatedUnitPrice: s.estimatedUnitPrice,
          notes: 'HR recruitment shortage',
        })),
      });
      await (tx as any).hrEquipmentRequest.update({
        where: { id: equipmentRequestId },
        data: { purchaseRequisitionId: created.id },
      });
      return created;
    });

    this.logger.log(`PR ${pr.prNumber} auto-created for equipment request ${equipmentRequestId} (${shortages.length} short items)`);
    return { id: pr.id, prNumber: pr.prNumber };
  }

  /**
   * จองของตอนจ้างสำเร็จ (แบบ B): บรรทัดไหนของพอ → เพิ่ม reservedQty + mark reserved
   * คืน items ที่อัพเดตแล้ว (เรียกภายใน transaction ของ HireService)
   */
  async reserveItems(tx: any, items: EquipmentLine[], tenantId: string, propertyId: string | null): Promise<{ items: EquipmentLine[]; reservedAny: boolean }> {
    const updated: EquipmentLine[] = [];
    let reservedAny = false;
    for (const line of items) {
      if (!line?.itemId) {
        updated.push(line);
        continue;
      }
      const warehouseId = await this.resolveWarehouseId(tx, tenantId, propertyId, line.warehouseId ?? null, line.itemId);
      if (!warehouseId) {
        updated.push({ ...line, reserved: false });
        continue;
      }
      const stock = await tx.warehouseStock.findUnique({
        where: { warehouseId_itemId: { warehouseId, itemId: line.itemId } },
      });
      const available = (stock?.quantity ?? 0) - (stock?.reservedQty ?? 0);
      if (stock && available >= line.qty) {
        await tx.warehouseStock.update({
          where: { warehouseId_itemId: { warehouseId, itemId: line.itemId } },
          data: { reservedQty: { increment: line.qty } },
        });
        updated.push({ ...line, reserved: true, warehouseId });
        reservedAny = true;
      } else {
        updated.push({ ...line, reserved: false, warehouseId });
      }
    }
    return { items: updated, reservedAny };
  }

  /**
   * ปลดจอง (ยกเลิกการจ้าง / คืนก่อนจ่าย) — ลด reservedQty ของบรรทัดที่จองไว้
   * ปลอดภัยเมื่อไม่มี INVENTORY_MODULE: บรรทัดไม่มี reserved=true ก็ไม่ทำอะไร
   */
  async releaseReservation(tx: any, issuance: { id: string; items: unknown }): Promise<void> {
    const items: EquipmentLine[] = Array.isArray(issuance.items) ? (issuance.items as EquipmentLine[]) : [];
    let changed = false;
    const updated: EquipmentLine[] = [];
    for (const line of items) {
      if (line?.reserved && line.itemId && line.warehouseId && !line.issued) {
        const stock = await tx.warehouseStock.findUnique({
          where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
        });
        if (stock) {
          await tx.warehouseStock.update({
            where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
            data: { reservedQty: Math.max(0, stock.reservedQty - line.qty) },
          });
        }
        updated.push({ ...line, reserved: false });
        changed = true;
      } else {
        updated.push(line);
      }
    }
    if (changed) {
      await tx.hrEquipmentIssuance.update({ where: { id: issuance.id }, data: { items: updated } });
    }
  }

  /**
   * จ่ายของจริง (Stage 6): ตัดสต๊อก + ลดจอง + สร้าง GOODS_ISSUE movement
   * แล้ว emit STOCK_MOVEMENT_CREATED ให้ cost accounting (referenceType = equipment_issuance)
   */
  async commitIssue(issuanceId: string, issuedLines: EquipmentLine[], tenantId: string, userId: string): Promise<void> {
    // แผนกที่ขอ = เจ้าของต้นทุน → ส่งไปกับ event ให้ listener map เข้า cost center ของแผนก
    const issuance = await (this.prisma as any).hrEquipmentIssuance.findFirst({
      where: { id: issuanceId, tenantId },
      include: { equipmentRequest: { include: { manpowerRequest: { select: { departmentId: true } } } } },
    });
    const departmentId: string | null = issuance?.equipmentRequest?.manpowerRequest?.departmentId ?? null;

    const events: StockMovementCreatedEvent[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const line of issuedLines) {
        if (!line?.itemId || !line.warehouseId) continue;
        const stock = await tx.warehouseStock.findUnique({
          where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
          include: { warehouse: { select: { propertyId: true } }, item: { select: { name: true } } },
        });
        if (!stock) continue;
        const deductQty = Math.min(line.qty, stock.quantity);
        if (deductQty <= 0) continue;
        const avgCost = Number(stock.avgCost);

        const movement = await tx.stockMovement.create({
          data: {
            tenantId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            type: 'GOODS_ISSUE',
            quantity: deductQty,
            unitCost: avgCost,
            totalCost: deductQty * avgCost,
            referenceType: 'equipment_issuance',
            referenceId: issuanceId,
            notes: `First-day equipment: ${line.name} x${deductQty}`,
            createdBy: userId,
          },
        });

        const newQty = stock.quantity - deductQty;
        await tx.warehouseStock.update({
          where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
          data: {
            quantity: newQty,
            totalValue: newQty * avgCost,
            ...(line.reserved && { reservedQty: Math.max(0, stock.reservedQty - line.qty) }),
          },
        });

        events.push({
          movementId: movement.id,
          tenantId,
          propertyId: stock.warehouse.propertyId,
          warehouseId: line.warehouseId,
          itemId: line.itemId,
          itemName: stock.item.name,
          type: 'GOODS_ISSUE',
          quantity: deductQty,
          totalCost: deductQty * avgCost,
          referenceType: 'equipment_issuance',
          referenceId: issuanceId,
          departmentId,
          createdBy: userId,
        });
      }
    });

    for (const event of events) {
      try {
        this.eventEmitter.emit(COST_EVENTS.STOCK_MOVEMENT_CREATED, event);
      } catch (error) {
        this.logger.warn(`Failed to emit stock movement event: ${(error as Error).message}`);
      }
    }
  }

  /**
   * คืนของ (ลาออก/ไม่ผ่านทดลองงาน): movement ย้อนกลับ (ADJUSTMENT_IN) + เพิ่มสต๊อกคืน
   */
  async commitReturn(issuance: { id: string; items: unknown }, tenantId: string, userId: string): Promise<void> {
    const items: EquipmentLine[] = Array.isArray(issuance.items) ? (issuance.items as EquipmentLine[]) : [];
    await this.prisma.$transaction(async (tx) => {
      for (const line of items) {
        if (!line?.issued || !line.itemId || !line.warehouseId) continue;
        const stock = await tx.warehouseStock.findUnique({
          where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
        });
        if (!stock) continue;
        const avgCost = Number(stock.avgCost);
        await tx.stockMovement.create({
          data: {
            tenantId,
            warehouseId: line.warehouseId,
            itemId: line.itemId,
            type: 'ADJUSTMENT_IN',
            quantity: line.qty,
            unitCost: avgCost,
            totalCost: line.qty * avgCost,
            referenceType: 'equipment_issuance_return',
            referenceId: issuance.id,
            notes: `Equipment returned: ${line.name} x${line.qty}`,
            createdBy: userId,
          },
        });
        const newQty = stock.quantity + line.qty;
        await tx.warehouseStock.update({
          where: { warehouseId_itemId: { warehouseId: line.warehouseId, itemId: line.itemId } },
          data: { quantity: newQty, totalValue: newQty * avgCost },
        });
      }
    });
  }

  /** สต๊อกคงเหลือพร้อมใช้ (quantity - reservedQty) รวมทุกคลัง หรือเฉพาะคลังที่ระบุ */
  private async availableQty(client: any, tenantId: string, itemId: string, warehouseId: string | null): Promise<number> {
    const stocks = await client.warehouseStock.findMany({
      where: {
        itemId,
        ...(warehouseId ? { warehouseId } : {}),
        warehouse: { tenantId, isActive: true, deletedAt: null },
      },
      select: { quantity: true, reservedQty: true },
    });
    return stocks.reduce((sum: number, s: { quantity: number; reservedQty: number }) => sum + (s.quantity - s.reservedQty), 0);
  }

  /** หา warehouse ที่ใช้จอง/ตัดสต๊อก: ที่ระบุไว้ → คลังที่มีของ → default → คลังแรก */
  private async resolveWarehouseId(
    tx: any,
    tenantId: string,
    propertyId: string | null,
    preferredId: string | null,
    itemId: string,
  ): Promise<string | null> {
    if (preferredId) {
      const exists = await tx.warehouse.findFirst({
        where: { id: preferredId, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      if (exists) return exists.id;
    }
    const propertyFilter = propertyId ? { propertyId } : {};
    const withStock = await tx.warehouseStock.findFirst({
      where: {
        itemId,
        quantity: { gt: 0 },
        warehouse: { tenantId, ...propertyFilter, isActive: true, deletedAt: null },
      },
      orderBy: { quantity: 'desc' },
      select: { warehouseId: true },
    });
    if (withStock) return withStock.warehouseId;
    const fallback = await tx.warehouse.findFirst({
      where: { tenantId, ...propertyFilter, isActive: true, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  /** เลขเอกสารแบบเดียวกับ procurement: PR-YYYYMM-NNNN ผ่าน DocumentSequence */
  private async generateDocNumber(tx: any, tenantId: string, docType: string, prefix: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix, yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `${prefix}-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
