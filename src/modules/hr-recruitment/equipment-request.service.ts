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
import { CreateEquipmentRequestDto, ApprovalDecisionDto } from './dto/recruitment.dto';
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

    const totalCost = dto.items.reduce((sum, item) => sum + (item.estimatedCost ?? 0) * item.qty, 0);
    const equipmentRoles = await this.approvalFlow.resolveRoles(tenantId, 'equipment');
    const request = await (this.prisma as any).hrEquipmentRequest.create({
      data: {
        tenantId,
        manpowerRequestId,
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
      await this.issueToHiredEmployeesAndAdvance(existing.manpowerRequestId, existing.id, tenantId);
    }

    this.audit(AuditAction.EQUIPMENT_REQUEST_APPROVE_STEP, id, tenantId, userId, fullyApproved ? 'Equipment request fully approved' : 'Equipment approval step recorded');
    return updated;
  }

  /**
   * หลังคำขอเบิกอนุมัติครบ: ออกใบเบิกวันแรกให้พนักงานที่จ้างแล้ว (status 'hired') ของคำขอสรรหานี้
   * ที่ยังไม่มีใบเบิกผูกกับคำขอเบิกนี้ จากนั้นเลื่อนสถานะคำขอสรรหา hired → onboarding (ขั้นรับของ)
   */
  private async issueToHiredEmployeesAndAdvance(manpowerRequestId: string, equipmentRequestId: string, tenantId: string): Promise<void> {
    const manpower = await (this.prisma as any).hrManpowerRequest.findFirst({
      where: { id: manpowerRequestId, tenantId },
      include: { candidates: { where: { status: 'hired' }, select: { hireRecord: { select: { employeeId: true } } } } },
    });
    if (!manpower) return;
    const equipment = await (this.prisma as any).hrEquipmentRequest.findFirst({
      where: { id: equipmentRequestId, tenantId },
      select: { items: true },
    });
    const employeeIds: string[] = (manpower.candidates ?? [])
      .map((c: any) => c.hireRecord?.employeeId)
      .filter((eid: string | null | undefined): eid is string => Boolean(eid));
    const hasInventory = await this.recruitmentInventory.isEnabled(tenantId);

    await this.prisma.$transaction(async (tx: any) => {
      for (const employeeId of employeeIds) {
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
      // เลื่อนขั้นเฉพาะเมื่อจ้างครบแล้ว (status = hired) — partial hire (recruiting) ยังไม่ขยับ
      if (manpower.status === 'hired') {
        await tx.hrManpowerRequest.updateMany({
          where: { id: manpower.id, status: 'hired' },
          data: { status: 'onboarding' },
        });
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
