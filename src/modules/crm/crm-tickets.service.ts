import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTicketDto,
  CsatScoreDto,
  QueryTicketsDto,
  TICKET_PRIORITIES,
  UpdateTicketDto,
} from './dto/create-ticket.dto';

/**
 * CRM Service Desk — ticket workflow with SLA tracking and
 * event-driven auto-creation (low review score, LINE complaint).
 */
@Injectable()
export class CrmTicketsService {
  private readonly logger = new Logger(CrmTicketsService.name);

  /** SLA defaults (in minutes) when slaDueAt is not provided. */
  private static readonly SLA_DEFAULTS: Record<(typeof TICKET_PRIORITIES)[number], number> = {
    urgent: 30,
    high: 120,
    normal: 480, // 8 hours
    low: 1440, // 24 hours
  };

  private static readonly WRITABLE_CREATE = [
    'subject',
    'description',
    'contactId',
    'guestId',
    'bookingId',
    'channel',
    'category',
    'priority',
    'assignedToId',
    'metadata',
  ] as const;

  private static readonly WRITABLE_UPDATE = [
    'subject',
    'description',
    'status',
    'priority',
    'category',
    'assignedToId',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryTicketsDto, tenantId?: string) {
    if (!tenantId) return { data: [], total: 0, page: 1, limit: 20 };

    const page = Math.max(parseInt(query.page ?? '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.guestId) where.guestId = query.guestId;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search } },
        { description: { contains: query.search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.crmTicket.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        }),
        this.prisma.crmTicket.count({ where }),
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
    const ticket = await this.prisma.crmTicket.findFirst({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  async create(dto: CreateTicketDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const sanitized: Record<string, unknown> = {};
    for (const key of CrmTicketsService.WRITABLE_CREATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }

    const priority = (dto.priority ?? 'normal') as (typeof TICKET_PRIORITIES)[number];
    const slaDueAt = dto.slaDueAt ? new Date(dto.slaDueAt) : this.computeSlaDueAt(priority);

    const data = {
      ...sanitized,
      priority,
      tenantId,
      slaDueAt,
    } as Parameters<PrismaService['crmTicket']['create']>[0]['data'];

    const ticket = await this.prisma.crmTicket.create({ data });
    this.logger.log(
      `Ticket created · id=${ticket.id} · priority=${priority} · channel=${ticket.channel}`,
    );
    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const ticket = await this.findOne(id, tenantId);

    const sanitized: Record<string, unknown> = {};
    for (const key of CrmTicketsService.WRITABLE_UPDATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.slaDueAt) sanitized.slaDueAt = new Date(dto.slaDueAt);

    // Auto-set timestamps based on status transitions
    if (sanitized.status === 'resolved' && !ticket.resolvedAt) {
      sanitized.resolvedAt = new Date();
    }
    if (sanitized.status === 'closed' && !ticket.closedAt) {
      sanitized.closedAt = new Date();
      if (!ticket.resolvedAt) sanitized.resolvedAt = new Date();
    }

    return this.prisma.crmTicket.update({ where: { id }, data: sanitized });
  }

  async assign(id: string, userId: string, tenantId?: string) {
    return this.update(id, { assignedToId: userId, status: 'in_progress' }, tenantId);
  }

  async resolve(id: string, tenantId?: string) {
    return this.update(id, { status: 'resolved' }, tenantId);
  }

  async close(id: string, tenantId?: string) {
    return this.update(id, { status: 'closed' }, tenantId);
  }

  async recordCsat(id: string, dto: CsatScoreDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);
    return this.prisma.crmTicket.update({
      where: { id },
      data: { csatScore: dto.score },
    });
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    await this.findOne(id, tenantId);
    return this.prisma.crmTicket.delete({ where: { id } });
  }

  /**
   * Event-driven creation helper. Used by review/messaging subscribers.
   * Swallows errors so it never blocks the source event handler.
   */
  async createFromEvent(
    tenantId: string,
    payload: {
      subject: string;
      description?: string;
      guestId?: string;
      bookingId?: string;
      channel: CreateTicketDto['channel'];
      category?: CreateTicketDto['category'];
      priority?: CreateTicketDto['priority'];
      metadata?: Record<string, unknown>;
    },
  ) {
    try {
      return await this.create(
        {
          subject: payload.subject,
          description: payload.description,
          guestId: payload.guestId,
          bookingId: payload.bookingId,
          channel: payload.channel,
          category: payload.category,
          priority: payload.priority ?? 'normal',
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : undefined,
        },
        tenantId,
      );
    } catch (error) {
      this.logger.error(`Failed to create event-driven ticket: ${(error as Error).message}`);
      return null;
    }
  }

  /** Returns Date in the future according to SLA defaults table. */
  private computeSlaDueAt(priority: (typeof TICKET_PRIORITIES)[number]): Date {
    const minutes = CrmTicketsService.SLA_DEFAULTS[priority] ?? 480;
    return new Date(Date.now() + minutes * 60_000);
  }
}
