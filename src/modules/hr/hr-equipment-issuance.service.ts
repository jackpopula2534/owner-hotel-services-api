import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { IssueEquipmentDto, AcknowledgeIssuanceDto, EditIssuanceDto } from './dto/hr-equipment-issuance.dto';
import { RecruitmentInventoryService, EquipmentLine } from './recruitment-inventory.service';

interface IssuanceItem {
  name: string;
  qty: number;
  serialNo?: string | null;
  issued: boolean;
  itemId?: string | null;
  warehouseId?: string | null;
  reserved?: boolean;
  [key: string]: unknown;
}

/**
 * Stage 6: first-day equipment issuance. Records created automatically at hire
 * time (HireService) from approved equipment requests; HR issues the items and
 * the employee acknowledges receipt.
 */
@Injectable()
export class HrEquipmentIssuanceService {
  private readonly logger = new Logger(HrEquipmentIssuanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly recruitmentInventory: RecruitmentInventoryService,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string): void {
    this.auditLog
      .log({ action, resource: AuditResource.EQUIPMENT_ISSUANCE, resourceId, category: AuditCategory.HR, tenantId, userId, description })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.status) where['status'] = query.status;
    const data = await (this.prisma as any).hrEquipmentIssuance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        equipmentRequest: { select: { id: true, manpowerRequestId: true, status: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const issuance = await (this.prisma as any).hrEquipmentIssuance.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        equipmentRequest: true,
      },
    });
    if (!issuance) throw new NotFoundException(`Equipment issuance ${id} not found`);
    return issuance;
  }

  /** HR hands over (a subset of) items — marks them issued, with optional serial numbers. */
  async issue(id: string, dto: IssueEquipmentDto, tenantId: string, userId: string) {
    const issuance = await this.findOne(id, tenantId);
    if (!['pending', 'reserved', 'partially_issued'].includes(issuance.status)) {
      throw new BadRequestException(`Issuance is not open (current: "${issuance.status}")`);
    }
    const items: IssuanceItem[] = Array.isArray(issuance.items) ? issuance.items : [];
    const newlyIssued: IssuanceItem[] = [];
    const updatedItems = items.map((item, index) => {
      const issuedItem = dto.items.find((i) => i.index === index);
      if (!issuedItem) return item;
      if (!item.issued) newlyIssued.push(item);
      return { ...item, issued: true, serialNo: issuedItem.serialNo ?? item.serialNo ?? null };
    });
    const allIssued = updatedItems.every((i) => i.issued);

    const updated = await (this.prisma as any).hrEquipmentIssuance.update({
      where: { id },
      data: {
        items: updatedItems,
        status: allIssued ? 'issued' : 'partially_issued',
        issuedBy: userId,
        issuedAt: new Date(),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });

    // มี INVENTORY_MODULE → ตัดสต๊อกจริง (GOODS_ISSUE + ลดจอง) แล้วส่ง event ให้บัญชีต้นทุน
    if (await this.recruitmentInventory.isEnabled(tenantId)) {
      try {
        await this.recruitmentInventory.commitIssue(id, newlyIssued as EquipmentLine[], tenantId, userId);
      } catch (error) {
        this.logger.error(`Stock deduction failed for issuance ${id}: ${(error as Error).message}`);
      }
    }

    this.audit(AuditAction.EQUIPMENT_ISSUE, id, tenantId, userId, `Equipment issued (${dto.items.length} items, ${allIssued ? 'complete' : 'partial'})`);
    return updated;
  }

  /**
   * แก้ไขใบที่จ่ายแล้ว — ปรับ serial number / หมายเหตุ ของรายการที่ issued แล้ว
   * โดย "ไม่" ตัดสต็อกซ้ำและ "ไม่" เปลี่ยนสถานะใบ. ใช้แทนการกด "จ่ายของ" ซ้ำ
   * เพื่อกันการ issue ทับจนนับซ้ำ.
   */
  async editIssuance(id: string, dto: EditIssuanceDto, tenantId: string, userId: string) {
    const issuance = await this.findOne(id, tenantId);
    if (!['partially_issued', 'issued'].includes(issuance.status)) {
      throw new BadRequestException(`Only issued records can be edited (current: "${issuance.status}")`);
    }

    const items: IssuanceItem[] = Array.isArray(issuance.items) ? issuance.items : [];
    const edits = new Map((dto.items ?? []).map((i) => [i.index, i]));
    const updatedItems = items.map((item, index) => {
      const edit = edits.get(index);
      // แก้ได้เฉพาะรายการที่จ่ายแล้ว — ไม่แตะ issued/qty เพื่อกันการนับซ้ำ
      if (!edit || !item.issued) return item;
      return { ...item, serialNo: edit.serialNo === '' ? null : edit.serialNo ?? item.serialNo ?? null };
    });

    const updated = await (this.prisma as any).hrEquipmentIssuance.update({
      where: { id },
      data: {
        items: updatedItems,
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        equipmentRequest: { select: { id: true, manpowerRequestId: true, status: true } },
      },
    });

    this.audit(AuditAction.UPDATE, id, tenantId, userId, `Equipment issuance edited (${edits.size} items adjusted)`);
    return updated;
  }

  /** Employee signs for the received items. */
  async acknowledge(id: string, dto: AcknowledgeIssuanceDto, tenantId: string, userId: string) {
    const issuance = await this.findOne(id, tenantId);
    if (issuance.status !== 'issued') {
      throw new BadRequestException(`All items must be issued before acknowledgement (current: "${issuance.status}")`);
    }
    if (issuance.acknowledgedAt) throw new BadRequestException('Issuance already acknowledged');

    const updated = await (this.prisma as any).hrEquipmentIssuance.update({
      where: { id },
      data: {
        acknowledgedAt: new Date(),
        signatureUrl: dto.signatureUrl ?? null,
      },
    });
    this.audit(AuditAction.EQUIPMENT_ACKNOWLEDGE, id, tenantId, userId, 'Employee acknowledged equipment receipt');
    return updated;
  }

  /** Offboarding / failed probation: mark everything returned. */
  async markReturned(id: string, tenantId: string, userId: string) {
    const issuance = await this.findOne(id, tenantId);
    if (issuance.status === 'returned') throw new BadRequestException('Issuance already returned');

    // มี INVENTORY_MODULE → ของที่จ่ายแล้วคืนเข้าคลัง (movement ย้อนกลับ) + ปลดจองของที่ค้าง
    if (await this.recruitmentInventory.isEnabled(tenantId)) {
      try {
        await this.recruitmentInventory.commitReturn(issuance, tenantId, userId);
        await this.prisma.$transaction(async (tx) => {
          await this.recruitmentInventory.releaseReservation(tx, issuance);
        });
      } catch (error) {
        this.logger.error(`Stock return failed for issuance ${id}: ${(error as Error).message}`);
      }
    }

    const updated = await (this.prisma as any).hrEquipmentIssuance.update({
      where: { id },
      data: { status: 'returned' },
    });
    this.audit(AuditAction.UPDATE, id, tenantId, userId, 'Equipment marked as returned');
    return updated;
  }
}
