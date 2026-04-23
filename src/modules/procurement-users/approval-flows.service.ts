import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApprovalDocumentTypeDto,
  ApproverTypeDto,
  CreateApprovalFlowDto,
  CreateApprovalFlowStepDto,
  UpdateApprovalFlowDto,
} from './dto/approval-flow.dto';

@Injectable()
export class ApprovalFlowsService {
  private readonly logger = new Logger(ApprovalFlowsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private serializeAmount(value?: number | null): Prisma.Decimal | null {
    if (value === undefined || value === null) return null;
    return value as unknown as Prisma.Decimal;
  }

  private validateSteps(steps: CreateApprovalFlowStepDto[]): void {
    if (!steps || steps.length === 0) {
      throw new BadRequestException('Flow must have at least 1 step');
    }
    const seen = new Set<number>();
    for (const s of steps) {
      if (seen.has(s.stepOrder)) {
        throw new BadRequestException(`Duplicate stepOrder: ${s.stepOrder}`);
      }
      seen.add(s.stepOrder);

      if (s.approverType === ApproverTypeDto.SPECIFIC_USER) {
        if (!s.approverUserIds || s.approverUserIds.length === 0) {
          throw new BadRequestException(
            `Step "${s.name}" requires at least 1 approverUserIds when approverType=SPECIFIC_USER`,
          );
        }
      }
      if (s.approverType === ApproverTypeDto.ROLE && !s.approverRole) {
        throw new BadRequestException(
          `Step "${s.name}" requires approverRole when approverType=ROLE`,
        );
      }
      if (s.minApprovals && s.approverUserIds && s.minApprovals > s.approverUserIds.length) {
        throw new BadRequestException(
          `Step "${s.name}": minApprovals (${s.minApprovals}) > number of approvers (${s.approverUserIds.length})`,
        );
      }
    }
  }

  async create(dto: CreateApprovalFlowDto, tenantId: string, createdBy: string) {
    this.validateSteps(dto.steps);

    // Enforce single default per documentType
    if (dto.isDefault) {
      await (this.prisma as any).approvalFlow.updateMany({
        where: { tenantId, documentType: dto.documentType, isDefault: true },
        data: { isDefault: false },
      });
    }

    const flow = await (this.prisma as any).approvalFlow.create({
      data: {
        tenantId,
        propertyId: dto.propertyId ?? null,
        name: dto.name,
        description: dto.description ?? null,
        documentType: dto.documentType,
        minAmount: this.serializeAmount(dto.minAmount),
        maxAmount: this.serializeAmount(dto.maxAmount),
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        createdBy,
        steps: {
          create: dto.steps.map((s) => ({
            stepOrder: s.stepOrder,
            name: s.name,
            approverType: s.approverType,
            approverRole: s.approverRole ?? null,
            minApprovals: s.minApprovals ?? 1,
            isParallel: s.isParallel ?? false,
            slaHours: s.slaHours ?? null,
            approvers:
              s.approverType === ApproverTypeDto.SPECIFIC_USER && s.approverUserIds
                ? {
                    create: s.approverUserIds.map((userId, idx) => ({
                      userId,
                      order: idx,
                    })),
                  }
                : undefined,
          })),
        },
      },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: { approvers: { orderBy: { order: 'asc' } } },
        },
      },
    });

    this.logger.log(
      `Approval flow created: ${flow.name} (${flow.documentType}, ${flow.steps.length} steps) tenant=${tenantId}`,
    );
    return { success: true, data: flow };
  }

  async findAll(tenantId: string, documentType?: ApprovalDocumentTypeDto) {
    const flows = await (this.prisma as any).approvalFlow.findMany({
      where: {
        tenantId,
        ...(documentType ? { documentType } : {}),
      },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: {
            approvers: {
              orderBy: { order: 'asc' },
              include: {
                user: {
                  select: { id: true, email: true, firstName: true, lastName: true, role: true },
                },
              },
            },
          },
        },
      },
      orderBy: [{ documentType: 'asc' }, { isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { success: true, data: flows };
  }

  async findOne(id: string, tenantId: string) {
    const flow = await (this.prisma as any).approvalFlow.findFirst({
      where: { id, tenantId },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: {
            approvers: {
              orderBy: { order: 'asc' },
              include: {
                user: {
                  select: { id: true, email: true, firstName: true, lastName: true, role: true },
                },
              },
            },
          },
        },
      },
    });
    if (!flow) throw new NotFoundException('Approval flow not found');
    return { success: true, data: flow };
  }

  async update(id: string, tenantId: string, dto: UpdateApprovalFlowDto) {
    const existing = await (this.prisma as any).approvalFlow.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Approval flow not found');

    // Handle isDefault uniqueness per documentType
    const docType = dto.documentType ?? existing.documentType;
    if (dto.isDefault) {
      await (this.prisma as any).approvalFlow.updateMany({
        where: {
          tenantId,
          documentType: docType,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    // If steps supplied → full replace for simplicity
    if (dto.steps) {
      this.validateSteps(dto.steps);
      await (this.prisma as any).approvalFlowStep.deleteMany({ where: { flowId: id } });
    }

    const updated = await (this.prisma as any).approvalFlow.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        documentType: dto.documentType,
        minAmount:
          dto.minAmount !== undefined ? this.serializeAmount(dto.minAmount) : undefined,
        maxAmount:
          dto.maxAmount !== undefined ? this.serializeAmount(dto.maxAmount) : undefined,
        isActive: dto.isActive,
        isDefault: dto.isDefault,
        ...(dto.steps
          ? {
              steps: {
                create: dto.steps.map((s) => ({
                  stepOrder: s.stepOrder,
                  name: s.name,
                  approverType: s.approverType,
                  approverRole: s.approverRole ?? null,
                  minApprovals: s.minApprovals ?? 1,
                  isParallel: s.isParallel ?? false,
                  slaHours: s.slaHours ?? null,
                  approvers:
                    s.approverType === ApproverTypeDto.SPECIFIC_USER && s.approverUserIds
                      ? {
                          create: s.approverUserIds.map((userId, idx) => ({
                            userId,
                            order: idx,
                          })),
                        }
                      : undefined,
                })),
              },
            }
          : {}),
      },
      include: {
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: { approvers: { orderBy: { order: 'asc' } } },
        },
      },
    });

    return { success: true, data: updated };
  }

  async remove(id: string, tenantId: string): Promise<{ success: true }> {
    const flow = await (this.prisma as any).approvalFlow.findFirst({
      where: { id, tenantId },
    });
    if (!flow) throw new NotFoundException('Approval flow not found');

    await (this.prisma as any).approvalFlow.delete({ where: { id } });
    return { success: true };
  }
}
