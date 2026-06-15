import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  ApprovalChain,
  approveStep,
  rejectStep,
  buildApprovalChain,
  isChainApproved,
} from '../../common/types/approval-chain';
import { CreateEquipmentRequestDto, UpdateEquipmentRequestDto, ApprovalDecisionDto } from './dto/recruitment.dto';
import { ApprovalFlowService } from './approval-flow.service';
import { RecruitmentInventoryService } from '../hr/recruitment-inventory.service';

/**
 * Stage 3: equipment request for a manpower request. Runs in parallel with
 * recruiting/interviewing but must be approved before first-day issuance.
 */
@Injectable()
export class EquipmentRequestService {
  private readonly logger = new Logger(EquipmentRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly approvalFlow: ApprovalFlowService,
    private readonly recruitmentInventory: RecruitmentInventoryService,
  ) {}

  private audit(action: AuditAction, resourceId: string, tenantId: string, userId: string, description: string): void {
    this.auditLog
      .log({
        action,
        resource: AuditResource.EQUIPMENT_REQUEST,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        description,
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  async findOne(id: string, tenantId: string) {
    const request = await (this.prisma as any).hrEquipmentRequest.findFirst({
      where: { id, tenantId },
      include: { manpowerRequest: { select: { id: true, requestNo: true, status: true } }, issuances: true },
    });
    if (!request) throw new NotFoundException(`Equipment request ${id} not found`);
    return request;
  }

  /**
   * findOne + ป้ายสต๊อก (🟢มี/🔴ต้องสั่ง) ต่อบรรทัดที่ผูก itemId และเลข PR ที่เชื่อม
   * ถ้าไม่มี INVENTORY_MODULE คืนใบเบิกแบบ checklist อิสระ (availability = null)
   */
  async findOneWithAvailability(id: string, tenantId: string) {
    const request = await this.findOne(id, tenantId);
    const hasInventory = await this.recruitmentInventory.isEnabled(tenantId);
    if (!hasInventory) return { ...request, hasInventory: false, availability: null, purchaseRequisition: null };

    const items = Array.isArray(request.items) ? request.items : [];
    const availability = await this.recruitmentInventory.checkAvailability(items, tenantId);
    const purchaseRequisition = request.purchaseRequisitionId
      ? await this.prisma.purchaseRequisition.findFirst({
          where: { id: request.purchaseRequisitionId, tenantId },
          select: { id: true, prNumber: true, status: true },
        })
      : null;
    return { ...request, hasInventory: true, availability, purchaseRequisition };
  }

  async create(manpowerRequestId: string, dto: CreateEquipmentRequestDto, tenantId: string, userId: string) {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
    });
    if (!manpower) throw new NotFoundException(`Manpower request ${manpowerRequestId} not found`);
    if (['draft', 'rejected', 'cancelled'].includes(manpower.status)) {
      throw new BadRequestException(`Cannot request equipment for a "${manpower.status}" manpower request`);
    }
    if (!dto.items.length) throw new BadRequestException('At least one equipment item is required');

    // ── เบิกของ "ทีละคน": ผูกคำขอเบิกกับพนักงานที่จ้างแล้วรายคน ──
    // ใบสรรหารับได้หลายอัตรา จึงต้องระบุว่าเบิกให้ใคร เพื่อไม่ให้ปนกัน
    const hiredEmployeeIds = await this.hiredEmployeeIds(manpowerRequestId, tenantId);
    if (hiredEmployeeIds.length > 0) {
      if (!dto.employeeId) {
        throw new BadRequestException('employeeId is required — ระบุพนักงานที่จะเบิกของให้ (เบิกทีละคน)');
      }
      if (!hiredEmployeeIds.includes(dto.employeeId)) {
        throw new BadRequestException('employeeId is not a hired employee of this manpower request');
      }
      // กันคำขอซ้ำต่อคน: หนึ่งพนักงานมีคำขอเบิกที่ยัง active (ไม่ถูกปฏิเสธ) ได้ใบเดียว
      const dup = await (this.prisma as any).hrEquipmentRequest.findFirst({
        where: { tenantId, manpowerRequestId, employeeId: dto.employeeId, status: { not: 'rejected' } },
      });
      if (dup) {
        throw new BadRequestException('พนักงานคนนี้มีคำขอเบิกอยู่แล้ว — แก้ไขคำขอเดิมแทนการสร้างใหม่');
      }
    }

    const totalCost = dto.items.reduce((sum, item) => sum + (item.estimatedCost ?? 0) * item.qty, 0);
    const equipmentRoles = await this.approvalFlow.resolveRoles(tenantId, 'equipment');
    const request = await (this.prisma as any).hrEquipmentRequest.create({
      data: {
        tenantId,
        manpowerRequestId,
        employeeId: dto.employeeId ?? null,
        items: dto.items.map((i) => ({ ...i, estimatedCost: i.estimatedCost ?? null, note: i.note ?? null })),
        totalCost,
        status: 'pending',
        approvalChain: buildApprovalChain(equipmentRoles),
        requestedBy: userId,
      },
    });
    this.audit(AuditAction.EQUIPMENT_REQUEST_SUBMIT, request.id, tenantId, userId, `Equipment requested for ${manpower.requestNo} (${dto.items.length} items)`);
    return request;
  }

  /** id พนักงานที่จ้างแล้ว (มี employee ผูก) ของใบสรรหานี้ — ใช้ตรวจการเบิกรายคน */
  private async hiredEmployeeIds(manpowerRequestId: string, tenantId: string): Promise<string[]> {
    const candidates = await (this.prisma as any).hrCandidate.findMany({
      where: { tenantId, manpowerRequestId, status: 'hired' },
      select: { hireRecord: { select: { employeeId: true } } },
    });
    return candidates
      .map((c: any) => c.hireRecord?.employeeId)
      .filter((eid: string | null | undefined): eid is string => Boolean(eid));
  }

  /**
   * แก้ไขรายการของคำขอเบิกที่ยัง "pending" (ยังไม่อนุมัติ) — กันการสร้างคำขอซ้ำ
   * แก้ได้เฉพาะตอน pending เท่านั้น; เมื่ออนุมัติ/ปฏิเสธไปแล้วจะแก้ไม่ได้
   */
  async update(id: string, dto: UpdateEquipmentRequestDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Cannot edit a "${existing.status}" equipment request (only pending requests are editable)`);
    }
    if (!dto.items.length) throw new BadRequestException('At least one equipment item is required');

    const totalCost = dto.items.reduce((sum, item) => sum + (item.estimatedCost ?? 0) * item.qty, 0);
    const updated = await (this.prisma as any).hrEquipmentRequest.update({
      where: { id },
      data: {
        items: dto.items.map((i) => ({ ...i, estimatedCost: i.estimatedCost ?? null, note: i.note ?? null })),
        totalCost,
      },
    });
    this.audit(AuditAction.EQUIPMENT_REQUEST_UPDATE, id, tenantId, userId, `Equipment request edited (${dto.items.length} items)`);
    return updated;
  }

  async approve(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Equipment request is not pending (current: "${existing.status}")`);
    }
    const chain = approveStep((existing.approvalChain ?? []) as ApprovalChain, userId, dto.note);
    const fullyApproved = isChainApproved(chain);
    const updated = await (this.prisma as any).hrEquipmentRequest.update({
      where: { id },
      data: { approvalChain: chain, ...(fullyApproved && { status: 'approved' }) },
    });

    // อนุมัติครบ + มี INVENTORY_MODULE → ของขาดออก PR อัตโนมัติ (ไม่ block การอนุมัติถ้าพลาด)
    if (fullyApproved && (await this.recruitmentInventory.isEnabled(tenantId))) {
      try {
        const pr = await this.recruitmentInventory.createPrForShortage(id, tenantId, userId);
        if (pr) {
          this.audit(AuditAction.EQUIPMENT_REQUEST_APPROVE_STEP, id, tenantId, userId, `PR ${pr.prNumber} auto-created for short items`);
        }
      } catch (error) {
        this.logger.error(`Auto-PR creation failed for equipment request ${id}: ${(error as Error).message}`);
      }
    }

    // อนุมัติครบ → ออกใบเบิก (issuance) ให้พนักงานที่จ้างแล้วซึ่งยังไม่มีใบเบิกของคำขอนี้
    // แล้วเลื่อนคำขอสรรหาจากขั้น "ขออุปกรณ์" (hired) ไปขั้น "รับของ" (onboarding)
    // กรณีขออุปกรณ์ "หลังจ้าง": acceptOffer ผ่านไปแล้วจึงยังไม่มี issuance — สร้างตรงนี้
    if (fullyApproved) {
      await this.issueToHiredEmployeesAndAdvance(existing.manpowerRequestId, existing.id, existing.employeeId ?? null, tenantId);
    }

    this.audit(AuditAction.EQUIPMENT_REQUEST_APPROVE_STEP, id, tenantId, userId, fullyApproved ? 'Equipment request fully approved' : 'Equipment approval step recorded');
    return updated;
  }

  /**
   * หลังคำขอเบิกอนุมัติครบ: ออกใบเบิกวันแรกให้พนักงานเป้าหมายของคำขอเบิกนี้
   * - คำขอผูกพนักงานรายคน (employeeId มีค่า) → ออกใบเบิกให้คนนั้นคนเดียว (เบิกทีละคน)
   * - คำขอแบบเดิม (employeeId = null) → ออกใบเบิกให้พนักงานที่จ้างแล้วทุกคน (backward-compat)
   * จากนั้นเลื่อนสถานะ hired → onboarding (ขั้นรับของ) เฉพาะเมื่อพนักงานทุกคน "มีใบเบิกครบแล้ว"
   * เพื่อไม่ให้ใบเดินหน้าทั้งที่ยังเบิกให้ไม่ครบทุกคน
   */
  private async issueToHiredEmployeesAndAdvance(
    manpowerRequestId: string,
    equipmentRequestId: string,
    requestEmployeeId: string | null,
    tenantId: string,
  ): Promise<void> {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
      include: { candidates: { where: { status: 'hired' }, select: { hireRecord: { select: { employeeId: true } } } } },
    });
    if (!manpower) return;
    const equipment = await (this.prisma as any).hrEquipmentRequest.findFirst({
      where: { id: equipmentRequestId, tenantId },
      select: { items: true },
    });
    const hiredEmployeeIds: string[] = (manpower.candidates ?? [])
      .map((c: any) => c.hireRecord?.employeeId)
      .filter((eid: string | null | undefined): eid is string => Boolean(eid));
    // คำขอผูกรายคน → ออกใบเบิกให้คนนั้นเท่านั้น (ถ้ายังเป็นพนักงานที่จ้างอยู่)
    const targetEmployeeIds = requestEmployeeId
      ? hiredEmployeeIds.filter((eid) => eid === requestEmployeeId)
      : hiredEmployeeIds;
    const hasInventory = await this.recruitmentInventory.isEnabled(tenantId);

    await this.prisma.$transaction(async (tx: any) => {
      for (const employeeId of targetEmployeeIds) {
        const already = await tx.hrEquipmentIssuance.findFirst({
          where: { tenantId, equipmentRequestId, employeeId },
        });
        if (already) continue;
        const items = Array.isArray(equipment?.items) ? equipment.items : [];
        let issuanceItems = items.map((i: Record<string, unknown>) => ({ ...i, issued: false }));
        let issuanceStatus = 'pending';
        if (hasInventory) {
          const reservation = await this.recruitmentInventory.reserveItems(tx, issuanceItems as any[], tenantId, manpower.propertyId ?? null);
          issuanceItems = reservation.items as any[];
          if (reservation.reservedAny) issuanceStatus = 'reserved';
        }
        await tx.hrEquipmentIssuance.create({
          data: { tenantId, equipmentRequestId, employeeId, items: issuanceItems, status: issuanceStatus },
        });
      }

      // เลื่อนขั้นเฉพาะเมื่อจ้างครบ (status = hired) และพนักงานทุกคน "มีใบเบิกแล้ว"
      // เบิกทีละคน: คนแรกอนุมัติแล้วยังไม่ครบ ใบจึงยังค้างขั้น "ขออุปกรณ์" จนกว่าจะเบิกครบทุกคน
      if (manpower.status === 'hired' && hiredEmployeeIds.length > 0) {
        const issuedEmployees: Array<{ employeeId: string }> = await tx.hrEquipmentIssuance.findMany({
          where: { tenantId, employeeId: { in: hiredEmployeeIds } },
          select: { employeeId: true },
          distinct: ['employeeId'],
        });
        const issuedSet = new Set(issuedEmployees.map((i) => i.employeeId));
        const allIssued = hiredEmployeeIds.every((eid) => issuedSet.has(eid));
        if (allIssued) {
          await tx.hrManpowerRequest.updateMany({
            where: { id: manpower.id, status: 'hired' },
            data: { status: 'onboarding' },
          });
        }
      }
    });
  }

  async reject(id: string, dto: ApprovalDecisionDto, tenantId: string, userId: string) {
    const existing = await this.findOne(id, tenantId);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Equipment request is not pending (current: "${existing.status}")`);
    }
    const chain = rejectStep((existing.approvalChain ?? []) as ApprovalChain, userId, dto.note);
    const updated = await (this.prisma as any).hrEquipmentRequest.update({
      where: { id },
      data: { approvalChain: chain, status: 'rejected' },
    });
    this.audit(AuditAction.EQUIPMENT_REQUEST_REJECT, id, tenantId, userId, `Equipment request rejected: ${dto.note ?? '-'}`);
    return updated;
  }
}
