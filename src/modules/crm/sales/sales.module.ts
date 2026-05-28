import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LeadService } from './lead.service';
import { LeadController } from './lead.controller';
import { DealService } from './deal.service';
import { DealController } from './deal.controller';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';

/**
 * CRM Sales Pipeline — Phase 3
 *
 * Pillar: corporate / agent / group sales
 *   - Lead (inquiry capture, qualify → deal)
 *   - Deal (pipeline with stages + forecasting)
 *   - SalesActivity (timeline of notes/calls/emails/tasks)
 */
@Module({
  imports: [PrismaModule],
  controllers: [LeadController, DealController, ActivityController],
  providers: [LeadService, DealService, ActivityService],
  exports: [LeadService, DealService, ActivityService],
})
export class CrmSalesModule {}
