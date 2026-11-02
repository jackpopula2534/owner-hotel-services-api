import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { HrModule } from '../hr/hr.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EmailModule } from '../../email/email.module';
import { SmsChannelAdapter } from '../crm/automation/channels/sms.adapter';
import { ManpowerInsightsService } from './manpower-insights.service';
import { RecruitmentNotifierService } from './recruitment-notifier.service';
import { PositionKitService } from './position-kit.service';
import { PositionKitController } from './position-kit.controller';
import { ManpowerRequestService } from './manpower-request.service';
import { EquipmentRequestService } from './equipment-request.service';
import { CandidateService } from './candidate.service';
import { InterviewService } from './interview.service';
import { HireService } from './hire.service';
import { JobPostingService } from './job-posting.service';
import { ManpowerRequestController, EquipmentRequestController } from './manpower-request.controller';
import { CandidateController, InterviewController, HireRecordController } from './candidate.controller';
import { JobPostingController, PublicJobController } from './job-posting.controller';
import { ApprovalFlowController } from './approval-flow.controller';
import { ApprovalFlowService } from './approval-flow.service';
import { RecruitmentQueueProcessor, RECRUITMENT_QUEUE } from './queue/recruitment.queue.processor';
import { RecruitmentQueueScheduler } from './queue/recruitment.queue.scheduler';

/**
 * Recruitment pipeline (2026-06-10 redesign):
 * manpower request → budget → equipment → candidates/interviews → offer/hire
 * → first-day issuance → probation round (hr module).
 */
@Module({
  imports: [PrismaModule, AddonModule, HrModule, NotificationsModule, EmailModule, BullModule.registerQueue({ name: RECRUITMENT_QUEUE })],
  controllers: [
    ManpowerRequestController,
    EquipmentRequestController,
    CandidateController,
    InterviewController,
    HireRecordController,
    JobPostingController,
    PublicJobController,
    ApprovalFlowController,
    PositionKitController,
  ],
  providers: [
    ManpowerRequestService,
    EquipmentRequestService,
    CandidateService,
    InterviewService,
    HireService,
    JobPostingService,
    ApprovalFlowService,
    RecruitmentQueueProcessor,
    RecruitmentQueueScheduler,
    ManpowerInsightsService,
    RecruitmentNotifierService,
    PositionKitService,
    // stub SMS adapter (CRM) — ใช้ตรง ๆ ไม่ลากทั้ง CRM module
    SmsChannelAdapter,
  ],
  exports: [ManpowerRequestService, CandidateService, HireService, ApprovalFlowService],
})
export class HrRecruitmentModule {}
