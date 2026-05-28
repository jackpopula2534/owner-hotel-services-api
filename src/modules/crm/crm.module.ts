import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoyaltyModule } from '../../loyalty/loyalty.module';
import { CrmContactsService } from './crm-contacts.service';
import { CrmContactsController } from './crm-contacts.controller';
import { CrmTicketsService } from './crm-tickets.service';
import { CrmTicketsController } from './crm-tickets.controller';
import { CrmEventListener } from './crm-event.listener';
import { CrmAutomationModule } from './automation/automation.module';
import { CrmSalesModule } from './sales/sales.module';
import { CrmAiModule } from './ai/ai.module';

/**
 * CRM Module — Phase 1 + 2 + 3 + 4 (complete)
 *
 * Pillars enabled:
 *  - Guest 360 (CrmContact CRUD + stay history)
 *  - Service Desk (CrmTicket workflow + SLA)
 *  - Marketing Automation (Campaign + Journey Flow) — Phase 2
 *  - Sales Pipeline (Lead, Deal, Activity) — Phase 3
 *  - AI Insights (sentiment, churn prediction, smart segmentation) — Phase 4
 *  - Channel adapters (email/LINE/SMS/Push) — Phase 4
 *
 * See docs/CRM_PLAN.md.
 */
@Module({
  imports: [PrismaModule, LoyaltyModule, CrmAutomationModule, CrmSalesModule, CrmAiModule],
  controllers: [CrmContactsController, CrmTicketsController],
  providers: [CrmContactsService, CrmTicketsService, CrmEventListener],
  exports: [CrmContactsService, CrmTicketsService],
})
export class CrmModule {}
