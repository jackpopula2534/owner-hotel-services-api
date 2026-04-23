import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ProcurementUsersService } from './procurement-users.service';
import { ProcurementUsersController } from './procurement-users.controller';
import { ApprovalFlowsService } from './approval-flows.service';
import { ApprovalFlowsController } from './approval-flows.controller';

/**
 * Procurement Users & Approval Flows module.
 *
 * Provides tenant-scoped CRUD for:
 *  - Procurement user accounts (roles: procurement_manager, buyer, approver, receiver)
 *  - Approval flow templates (per documentType, with sequential/parallel steps)
 *
 * This mirrors the POS User pattern (see auth.controller) but is scoped under
 * the /procurement namespace and supports finer-grained metadata (approval
 * limits + permission matrix) needed by the Purchase-to-Pay workflow.
 */
@Module({
  imports: [PrismaModule],
  providers: [ProcurementUsersService, ApprovalFlowsService],
  controllers: [ProcurementUsersController, ApprovalFlowsController],
  exports: [ProcurementUsersService, ApprovalFlowsService],
})
export class ProcurementUsersModule {}
