import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../../prisma/prisma.module';
import { EmailModule } from '../../../email/email.module';
import { CampaignService } from './campaign.service';
import { CampaignController } from './campaign.controller';
import { CampaignProcessor } from './campaign.processor';
import { AudienceResolver } from './audience.resolver';
import { JourneyService } from './journey.service';
import { JourneyController } from './journey.controller';
import { JourneyScheduler } from './journey.scheduler';
import { JourneyEventListener } from './journey-event.listener';
import { CRM_CAMPAIGN_QUEUE } from './campaign.constants';
import { ChannelRegistry } from './channels/channel.registry';
import { EmailChannelAdapter } from './channels/email.adapter';
import { LineChannelAdapter } from './channels/line.adapter';
import { SmsChannelAdapter } from './channels/sms.adapter';
import { PushChannelAdapter } from './channels/push.adapter';

/**
 * CRM Automation — Phase 2 + 4
 *
 * Pillars enabled:
 *   - Campaign builder + scheduled dispatch (Bull queue 'crm-campaigns')
 *   - Multi-step Journey Flow (cron-driven advancement)
 *   - Auto-enroll listener for booking events
 *   - Channel adapters: email, line, sms (stub), push (stub) — Phase 4
 */
@Module({
  imports: [
    PrismaModule,
    EmailModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: CRM_CAMPAIGN_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [CampaignController, JourneyController],
  providers: [
    CampaignService,
    CampaignProcessor,
    AudienceResolver,
    JourneyService,
    JourneyScheduler,
    JourneyEventListener,
    // Channel adapters + registry
    EmailChannelAdapter,
    LineChannelAdapter,
    SmsChannelAdapter,
    PushChannelAdapter,
    ChannelRegistry,
  ],
  exports: [CampaignService, JourneyService, ChannelRegistry],
})
export class CrmAutomationModule {}
