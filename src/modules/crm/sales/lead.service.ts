import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLeadDto, QualifyLeadDto, QueryLeadsDto, UpdateLeadDto } from './dto/lead.dto';
import { STAGE_DEFAULT_PROBABILITY } from './dto/deal.dto';

/**
 * CrmLead service — manages inquiries from corporate / agent / website / walk-in.
 *
 * Lifecycle: new → contacted → qualified → converted (becomes a CrmDeal)
 *                                  ↓
 *                              unqualified / lost
 */
@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  private static readonly WRITABLE_CREATE = [
    'contactName',
    'companyName',
    'email',
    'phone',
    'source',
    'score',
    'estValue',
    'expectedCheckIn',
    'expectedCheckOut',
    'partySize',
    'notes',
    'contactId',
    'ownerUserId',
  ] as const;

  private static readonly WRITABLE_UPDATE = [
    'contactName',
    'companyName',
    'email',
    'phone',
    'status',
    'score',
    'estValue',
    'notes',
    'ownerUserId',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryLeadsDto, tenantId?: string) {
    if (!tenantId) return { data: [], total: 0, page: 1, limit: 20 };

    const page = Math.max(parseInt(query.page ?? '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.search) {
      where.OR = [
        { contactName: { contains: query.search } },
        { companyName: { contains: query.search } },
        { email: { contains: query.search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.crmLead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.crmLead.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') {
        return { data: [], total: 0, page, limit };
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const lead = await this.prisma.crmLead.findFirst({ where: { id, tenantId } });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  async create(dto: CreateLeadDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const sanitized: Record<string, unknown> = {};
    for (const key of LeadService.WRITABLE_CREATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.expectedCheckIn) sanitized.expectedCheckIn = new Date(dto.expectedCheckIn);
    if (dto.expectedCheckOut) sanitized.expectedCheckOut = new Date(dto.expectedCheckOut);

    const data = {
      ...sanitized,
      tenantId,
      status: 'new',
    } as Parameters<PrismaService['crmLead']['create']>[0]['data'];

    return this.prisma.crmLead.create({ data });
  }

  async update(id: string, dto: UpdateLeadDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);

    const sanitized: Record<string, unknown> = {};
    for (const key of LeadService.WRITABLE_UPDATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    return this.prisma.crmLead.update({ where: { id }, data: sanitized });
  }

  async assign(id: string, userId: string, tenantId?: string) {
    return this.update(id, { ownerUserId: userId }, tenantId);
  }

  /**
   * Qualify a lead — creates a CrmDeal and marks the lead as 'converted'.
   * Transactional: either both succeed or both fail.
   */
  async qualify(id: string, dto: QualifyLeadDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const lead = await this.findOne(id, tenantId);

    if (lead.status === 'converted') {
      throw new BadRequestException('Lead is already converted');
    }
    if (lead.status === 'lost' || lead.status === 'unqualified') {
      throw new BadRequestException(`Cannot qualify a ${lead.status} lead`);
    }

    return this.prisma.$transaction(async (tx) => {
      const probability = dto.probability ?? STAGE_DEFAULT_PROBABILITY.discovery;
      const deal = await tx.crmDeal.create({
        data: {
          tenantId,
          leadId: lead.id,
          contactId: lead.contactId,
          companyName: lead.companyName,
          name: dto.dealName,
          amount: dto.amount,
          probability,
          stage: 'discovery',
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
          ownerUserId: lead.ownerUserId,
          partySize: lead.partySize,
          checkInDate: lead.expectedCheckIn,
          checkOutDate: lead.expectedCheckOut,
          notes: lead.notes,
        },
      });

      await tx.crmLead.update({
        where: { id: lead.id },
        data: { status: 'converted', convertedDealId: deal.id },
      });

      return { lead: { ...lead, status: 'converted', convertedDealId: deal.id }, deal };
    });
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const lead = await this.findOne(id, tenantId);
    if (lead.status === 'converted') {
      throw new BadRequestException('Cannot delete a converted lead — delete the deal first');
    }
    return this.prisma.crmLead.delete({ where: { id } });
  }
}
