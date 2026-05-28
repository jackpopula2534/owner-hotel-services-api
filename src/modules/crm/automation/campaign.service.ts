import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceResolver } from './audience.resolver';
import { CreateCampaignDto, QueryCampaignsDto, UpdateCampaignDto } from './dto/campaign.dto';
import { CRM_CAMPAIGN_QUEUE, CAMPAIGN_JOB, DispatchJobData } from './campaign.constants';

/**
 * Manages CrmCampaign lifecycle: draft → scheduled → running → completed.
 * Dispatch is delegated to the Bull queue worker for non-blocking sends.
 */
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  private static readonly WRITABLE_CREATE = [
    'name',
    'description',
    'channel',
    'templateKey',
    'subject',
    'bodyOverride',
    'audienceQuery',
  ] as const;

  private static readonly WRITABLE_UPDATE = [
    'name',
    'description',
    'subject',
    'bodyOverride',
    'templateKey',
    'audienceQuery',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceResolver,
    @InjectQueue(CRM_CAMPAIGN_QUEUE) private readonly queue: Queue,
  ) {}

  async findAll(query: QueryCampaignsDto, tenantId?: string) {
    if (!tenantId) return { data: [], total: 0, page: 1, limit: 20 };

    const page = Math.max(parseInt(query.page ?? '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.channel) where.channel = query.channel;
    if (query.search) where.name = { contains: query.search };

    try {
      const [data, total] = await Promise.all([
        this.prisma.crmCampaign.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.crmCampaign.count({ where }),
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
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id, tenantId },
    });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    return campaign;
  }

  async create(dto: CreateCampaignDto, tenantId?: string, userId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    if (dto.channel === 'email' && !dto.subject && !dto.templateKey) {
      throw new BadRequestException('Email campaigns require subject or templateKey');
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of CampaignService.WRITABLE_CREATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.scheduledAt) sanitized.scheduledAt = new Date(dto.scheduledAt);

    const data = {
      ...sanitized,
      tenantId,
      createdById: userId ?? null,
      status: 'draft',
    } as Parameters<PrismaService['crmCampaign']['create']>[0]['data'];

    return this.prisma.crmCampaign.create({ data });
  }

  async update(id: string, dto: UpdateCampaignDto, tenantId?: string) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const campaign = await this.findOne(id, tenantId);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new BadRequestException(`Cannot edit campaign in status "${campaign.status}"`);
    }

    const sanitized: Record<string, unknown> = {};
    for (const key of CampaignService.WRITABLE_UPDATE) {
      const value = (dto as unknown as Record<string, unknown>)[key];
      if (value !== undefined) sanitized[key] = value;
    }
    if (dto.scheduledAt) sanitized.scheduledAt = new Date(dto.scheduledAt);

    return this.prisma.crmCampaign.update({ where: { id }, data: sanitized });
  }

  /** Returns the resolved audience size for a campaign without sending. */
  async previewAudience(id: string, tenantId: string) {
    const campaign = await this.findOne(id, tenantId);
    const query = AudienceResolver.parseQuery(campaign.audienceQuery ?? null);
    const size = await this.audience.estimateSize(tenantId, query);
    return { campaignId: id, estimatedSize: size, query };
  }

  /**
   * Schedule a campaign for dispatch. If scheduledAt is in the past,
   * dispatches immediately. Idempotent — calling twice is a no-op.
   */
  async schedule(id: string, tenantId: string) {
    const campaign = await this.findOne(id, tenantId);
    if (campaign.status === 'running' || campaign.status === 'completed') {
      throw new BadRequestException(`Campaign already ${campaign.status}, cannot schedule`);
    }

    const targetAt = campaign.scheduledAt ?? new Date();
    const delay = Math.max(targetAt.getTime() - Date.now(), 0);

    await this.queue.add(
      CAMPAIGN_JOB.DISPATCH,
      { campaignId: id, tenantId } satisfies DispatchJobData,
      { delay, jobId: `dispatch-${id}` },
    );

    return this.prisma.crmCampaign.update({
      where: { id },
      data: { status: 'scheduled', scheduledAt: targetAt },
    });
  }

  async cancel(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    try {
      const job = await this.queue.getJob(`dispatch-${id}`);
      if (job) await job.remove();
    } catch (error) {
      this.logger.warn(`Could not remove scheduled job for ${id}: ${(error as Error).message}`);
    }
    return this.prisma.crmCampaign.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async getStats(id: string, tenantId: string) {
    const campaign = await this.findOne(id, tenantId);
    return {
      campaignId: id,
      status: campaign.status,
      totalRecipients: campaign.totalRecipients,
      totalSent: campaign.totalSent,
      totalOpened: campaign.totalOpened,
      totalClicked: campaign.totalClicked,
      totalFailed: campaign.totalFailed,
      openRate: campaign.totalSent > 0 ? campaign.totalOpened / campaign.totalSent : 0,
      clickRate: campaign.totalSent > 0 ? campaign.totalClicked / campaign.totalSent : 0,
      startedAt: campaign.startedAt,
      completedAt: campaign.completedAt,
    };
  }

  async remove(id: string, tenantId: string) {
    const campaign = await this.findOne(id, tenantId);
    if (campaign.status === 'running') {
      throw new BadRequestException('Cannot delete a running campaign');
    }
    return this.prisma.crmCampaign.delete({ where: { id } });
  }
}
