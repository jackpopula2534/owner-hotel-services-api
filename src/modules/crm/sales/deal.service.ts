import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateDealDto,
  DEAL_STAGES,
  MoveStageDto,
  QueryDealsDto,
  STAGE_DEFAULT_PROBABILITY,
  UpdateDealDto,
} from './dto/deal.dto';

/**
 * CrmDeal service — pipeline management with stage transitions and forecasting.
 *
 * Stage rules:
 *   discovery → quoted → negotiation → won  (terminal)
 *                                    → lost (terminal, requires reason)
 *   Any non-terminal stage can move backward to a previous stage.
 */
@Injectable()
export class DealService {
  private readonly logger = new Logger(DealService.name);

  /** Forward progression order. Lost can be reached from any non-terminal stage. */
  private static readonly FORWARD_ORDER: readonly (typeof DEAL_STAGES)[number][] = [
    'discovery',
    'quoted',
    'negotiation',
    'won',
  ];

  private static readonly WRITABLE_CREATE = [
    'name',
    'companyName',
    'contactId',
    'leadId',
    'amount',
    'probability',
    'ownerUserId',
    'partySize',
    'notes',
  ] as const;

  private static readonly WRITABLE_UPDATE = [
    'name',
    'amount',
    'probability',
    'ownerUserId',
    'notes',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryDealsDto, tenantId?: string) {
    if (!tenantId) return { data: [], total: 0, page: 1, limit: 20 };

    const page = Math.max(parseInt(query.page ?? '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.stage) where.stage = query.stage;
    if (query.ownerUserId) where.ownerUserId = query.ownerUserId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { companyName: { contains: query.search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.crmDeal.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ stage: 'asc' }, { expectedCloseDate: 'asc' }],
        }),
        this.prisma.crmDeal.count({ where }),
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
    const deal = await this.prisma.crmDeal.findFirst({ where: { id, tenantId } });
    if (!deal) throw new NotFoundException(`Deal ${id} not found`);
    return deal;
  }

  async create(dto: CreateDealDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const sanitized: Record<string, unknown> = {};
    for (const key of DealService.WRITABLE_CREATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.expectedCloseDate) sanitized.expectedCloseDate = new Date(dto.expectedCloseDate);
    if (dto.checkInDate) sanitized.checkInDate = new Date(dto.checkInDate);
    if (dto.checkOutDate) sanitized.checkOutDate = new Date(dto.checkOutDate);

    const data = {
      ...sanitized,
      tenantId,
      stage: 'discovery',
      probability: dto.probability ?? STAGE_DEFAULT_PROBABILITY.discovery,
    } as Parameters<PrismaService['crmDeal']['create']>[0]['data'];

    return this.prisma.crmDeal.create({ data });
  }

  async update(id: string, dto: UpdateDealDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const deal = await this.findOne(id, tenantId);
    if (deal.stage === 'won' || deal.stage === 'lost') {
      throw new BadRequestException(`Cannot edit a ${deal.stage} deal`);
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of DealService.WRITABLE_UPDATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.expectedCloseDate) sanitized.expectedCloseDate = new Date(dto.expectedCloseDate);

    return this.prisma.crmDeal.update({ where: { id }, data: sanitized });
  }

  /**
   * Move a deal to a new stage. Validates progression and sets closedAt/probability.
   * Lost transitions require `lostReason`.
   */
  async moveStage(id: string, dto: MoveStageDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const deal = await this.findOne(id, tenantId);

    if (deal.stage === 'won' || deal.stage === 'lost') {
      throw new BadRequestException(`Deal is already ${deal.stage}`);
    }
    if (dto.stage === 'lost' && !dto.lostReason) {
      throw new BadRequestException('lostReason is required when moving to "lost"');
    }
    if (dto.stage === deal.stage) {
      throw new BadRequestException('Deal is already in that stage');
    }
    if (!this.isValidTransition(deal.stage as any, dto.stage as any)) {
      throw new BadRequestException(
        `Invalid stage transition from "${deal.stage}" to "${dto.stage}"`,
      );
    }

    const update: Record<string, unknown> = {
      stage: dto.stage,
      probability: STAGE_DEFAULT_PROBABILITY[dto.stage],
    };
    if (dto.stage === 'won' || dto.stage === 'lost') {
      update.closedAt = new Date();
    }
    if (dto.stage === 'lost') {
      update.lostReason = dto.lostReason;
    }

    return this.prisma.crmDeal.update({ where: { id }, data: update });
  }

  /**
   * Link generated bookings to a won deal. Stored as JSON array of booking IDs.
   * Called after Hotel Mgmt creates group bookings from the contract.
   */
  async attachBookings(id: string, bookingIds: string[], tenantId: string) {
    const deal = await this.findOne(id, tenantId);
    if (deal.stage !== 'won') {
      throw new BadRequestException('Can only attach bookings to a won deal');
    }
    const existing = this.parseBookingIds(deal.bookingIds);
    const merged = Array.from(new Set([...existing, ...bookingIds]));
    return this.prisma.crmDeal.update({
      where: { id },
      data: { bookingIds: JSON.stringify(merged) },
    });
  }

  /**
   * Pipeline forecast snapshot.
   * Returns count + total amount + weighted-by-probability per stage.
   */
  async forecast(tenantId: string) {
    if (!tenantId) return null;

    try {
      const deals = await this.prisma.crmDeal.findMany({
        where: {
          tenantId,
          stage: { in: ['discovery', 'quoted', 'negotiation'] },
        },
        select: { stage: true, amount: true, probability: true },
      });
      const wonDeals = await this.prisma.crmDeal.findMany({
        where: { tenantId, stage: 'won' },
        select: { amount: true },
      });
      const lostDeals = await this.prisma.crmDeal.count({
        where: { tenantId, stage: 'lost' },
      });

      const byStage: Record<string, { count: number; amount: number; weighted: number }> = {
        discovery: { count: 0, amount: 0, weighted: 0 },
        quoted: { count: 0, amount: 0, weighted: 0 },
        negotiation: { count: 0, amount: 0, weighted: 0 },
      };

      for (const d of deals) {
        const amount = Number(d.amount);
        const weighted = (amount * (d.probability ?? 0)) / 100;
        const bucket = byStage[d.stage];
        if (bucket) {
          bucket.count += 1;
          bucket.amount += amount;
          bucket.weighted += weighted;
        }
      }

      const wonAmount = wonDeals.reduce((s, d) => s + Number(d.amount), 0);
      const wonCount = wonDeals.length;
      const totalClosed = wonCount + lostDeals;
      const winRate = totalClosed > 0 ? wonCount / totalClosed : 0;

      return {
        pipeline: byStage,
        pipelineTotal: Object.values(byStage).reduce((s, b) => s + b.amount, 0),
        weightedTotal: Object.values(byStage).reduce((s, b) => s + b.weighted, 0),
        won: { count: wonCount, amount: wonAmount },
        lost: { count: lostDeals },
        winRate,
      };
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2021' || code === 'P2022') return null;
      throw error;
    }
  }

  async remove(id: string, tenantId: string) {
    const deal = await this.findOne(id, tenantId);
    if (deal.stage === 'won') {
      throw new BadRequestException('Cannot delete a won deal');
    }
    return this.prisma.crmDeal.delete({ where: { id } });
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  private isValidTransition(
    from: (typeof DEAL_STAGES)[number],
    to: (typeof DEAL_STAGES)[number],
  ): boolean {
    // 'lost' can be entered from any non-terminal stage
    if (to === 'lost') return from !== 'won' && from !== 'lost';
    // Forward-only along FORWARD_ORDER
    const fromIdx = DealService.FORWARD_ORDER.indexOf(from);
    const toIdx = DealService.FORWARD_ORDER.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return false;
    return toIdx > fromIdx; // strictly forward
  }

  private parseBookingIds(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
}
