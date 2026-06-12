import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { HrModule } from '../hr/hr.module';
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
  imports: [PrismaModule, AddonModule, HrModule, BullModule.registerQueue({ name: RECRUITMENT_QUEUE })],
  controllers: [
    ManpowerRequestController,
    EquipmentRequestController,
    CandidateController,
    InterviewController,
    HireRecordController,
    JobPostingController,
    PublicJobController,
    ApprovalFlowController,
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
  ],
  exports: [ManpowerRequestService, CandidateService, HireService, ApprovalFlowService],
})
export class HrRecruitmentModule {}
