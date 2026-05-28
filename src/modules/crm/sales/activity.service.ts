import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompleteActivityDto, CreateActivityDto } from './dto/activity.dto';

/**
 * Timeline of notes/calls/emails/meetings/tasks attached to a Lead or Deal.
 * At least one of leadId/dealId must be provided.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateActivityDto, tenantId?: string, authorUserId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (!dto.leadId && !dto.dealId) {
      throw new BadRequestException('Either leadId or dealId is required');
    }

    return this.prisma.crmSalesActivity.create({
      data: {
        tenantId,
        type: dto.type,
        subject: dto.subject,
        body: dto.body ?? null,
        leadId: dto.leadId ?? null,
        dealId: dto.dealId ?? null,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        authorUserId: authorUserId ?? null,
      },
    });
  }

  async listForLead(leadId: string, tenantId: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    return this.prisma.crmSalesActivity.findMany({
      where: { tenantId, leadId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  }

  async listForDeal(dealId: string, tenantId: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    return this.prisma.crmSalesActivity.findMany({
      where: { tenantId, dealId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
  }

  async completeTask(id: string, dto: CompleteActivityDto, tenantId: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const activity = await this.prisma.crmSalesActivity.findFirst({
      where: { id, tenantId },
    });
    if (!activity) throw new NotFoundException(`Activity ${id} not found`);
    if (activity.type !== 'task') {
      throw new BadRequestException('Only task activities can be completed');
    }
    return this.prisma.crmSalesActivity.update({
      where: { id },
      data: { completedAt: dto.completedAt ? new Date(dto.completedAt) : new Date() },
    });
  }

  async remove(id: string, tenantId: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const activity = await this.prisma.crmSalesActivity.findFirst({
      where: { id, tenantId },
    });
    if (!activity) throw new NotFoundException(`Activity ${id} not found`);
    return this.prisma.crmSalesActivity.delete({ where: { id } });
  }
}
