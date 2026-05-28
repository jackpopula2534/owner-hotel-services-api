import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceMember, AudienceResolver } from './audience.resolver';
import { ChannelRegistry } from './channels/channel.registry';
import {
  CAMPAIGN_JOB,
  CRM_CAMPAIGN_QUEUE,
  DeliverOneJobData,
  DispatchJobData,
} from './campaign.constants';

/**
 * Worker for the 'crm-campaigns' Bull queue.
 *
 * Phase 4: refactored to use ChannelRegistry — any channel registered in the
 * registry is automatically supported. To add a new channel, write a
 * ChannelAdapter implementation and register it in AutomationModule.
 */
@Injectable()
@Processor(CRM_CAMPAIGN_QUEUE)
export class CampaignProcessor {
  private readonly logger = new Logger(CampaignProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audience: AudienceResolver,
    private readonly channels: ChannelRegistry,
  ) {}

  // ──────────────────────────────────────────────────────────
  // DISPATCH — resolve audience and fan out
  // ──────────────────────────────────────────────────────────
  @Process(CAMPAIGN_JOB.DISPATCH)
  async handleDispatch(job: Job<DispatchJobData>) {
    const { campaignId, tenantId } = job.data;
    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    if (!campaign) {
      this.logger.warn(`dispatch: campaign ${campaignId} not found`);
      return;
    }
    if (campaign.status === 'completed' || campaign.status === 'cancelled') {
      this.logger.log(`dispatch: skipping campaign ${campaignId} (status=${campaign.status})`);
      return;
    }
    if (!this.channels.has(campaign.channel)) {
      this.logger.error(`dispatch: no adapter registered for channel "${campaign.channel}"`);
      await this.prisma.crmCampaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date() },
      });
      return;
    }

    await this.prisma.crmCampaign.update({
      where: { id: campaignId },
      data: { status: 'running', startedAt: new Date() },
    });

    const audience = await this.audience.resolve(
      tenantId,
      AudienceResolver.parseQuery(campaign.audienceQuery ?? null),
    );

    // Filter by adapter eligibility
    const eligible = audience.filter((m) => this.isEligibleForChannel(campaign.channel, m));
    this.logger.log(
      `dispatch ${campaignId}: ${audience.length} resolved · ${eligible.length} eligible (${campaign.channel})`,
    );

    if (eligible.length === 0) {
      await this.prisma.crmCampaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date(), totalRecipients: 0 },
      });
      return;
    }

    const deliveriesData = eligible.map((m) => ({
      campaignId,
      tenantId,
      guestId: m.guestId,
      contactId: m.contactId,
      recipient: m.email ?? m.guestId ?? '',
      status: 'pending',
    }));

    await this.prisma.crmCampaignDelivery.createMany({ data: deliveriesData });

    await this.prisma.crmCampaign.update({
      where: { id: campaignId },
      data: { totalRecipients: eligible.length },
    });

    const created = await this.prisma.crmCampaignDelivery.findMany({
      where: { campaignId, status: 'pending' },
      select: { id: true },
    });

    if (job.queue) {
      for (const delivery of created) {
        await (job.queue as any).add(CAMPAIGN_JOB.DELIVER_ONE, {
          deliveryId: delivery.id,
          campaignId,
          tenantId,
        } satisfies DeliverOneJobData);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // DELIVER ONE — send single message via the resolved adapter
  // ──────────────────────────────────────────────────────────
  @Process(CAMPAIGN_JOB.DELIVER_ONE)
  async handleDeliverOne(job: Job<DeliverOneJobData>) {
    const { deliveryId, campaignId, tenantId } = job.data;
    const delivery = await this.prisma.crmCampaignDelivery.findFirst({
      where: { id: deliveryId, tenantId },
    });
    if (!delivery || delivery.status !== 'pending') return;

    const campaign = await this.prisma.crmCampaign.findFirst({
      where: { id: campaignId, tenantId },
    });
    if (!campaign) return;

    const adapter = this.channels.resolve(campaign.channel);
    if (!adapter) {
      await this.prisma.crmCampaignDelivery.update({
        where: { id: deliveryId },
        data: { status: 'failed', errorMessage: `no adapter for ${campaign.channel}` },
      });
      await this.bumpCampaignCounter(campaignId, 'totalFailed');
      return;
    }

    const result = await adapter.send({
      tenantId,
      recipient: delivery.recipient,
      guestId: delivery.guestId,
      subject: campaign.subject,
      templateKey: campaign.templateKey,
      bodyOverride: campaign.bodyOverride,
    });

    if (result.success) {
      await this.prisma.crmCampaignDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'sent',
          sentAt: new Date(),
          metadata: result.providerMessageId
            ? JSON.stringify({ providerMessageId: result.providerMessageId })
            : null,
        },
      });
      await this.bumpCampaignCounter(campaignId, 'totalSent');
    } else {
      this.logger.warn(`deliver-one ${deliveryId} failed: ${result.errorMessage}`);
      await this.prisma.crmCampaignDelivery.update({
        where: { id: deliveryId },
        data: { status: 'failed', errorMessage: result.errorMessage ?? 'unknown' },
      });
      await this.bumpCampaignCounter(campaignId, 'totalFailed');
    }

    const pendingCount = await this.prisma.crmCampaignDelivery.count({
      where: { campaignId, status: 'pending' },
    });
    if (pendingCount === 0) {
      await this.prisma.crmCampaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date() },
      });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  private isEligibleForChannel(channel: string, member: AudienceMember): boolean {
    if (channel === 'email') return !!member.email;
    // line/sms/push require guestId — adapters perform the final eligibility check
    return !!member.guestId;
  }

  private async bumpCampaignCounter(
    campaignId: string,
    field: 'totalSent' | 'totalOpened' | 'totalClicked' | 'totalFailed',
  ) {
    await this.prisma.crmCampaign.update({
      where: { id: campaignId },
      data: { [field]: { increment: 1 } },
    });
  }
}
