import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { BusinessOverviewService } from './business-overview.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';

@Module({
  // AddonModule supplies the entitlements the cross-system overview is gated on —
  // it decides which modules a tenant is even allowed to see.
  imports: [PrismaModule, AddonModule],
  controllers: [DashboardController],
  providers: [DashboardService, BusinessOverviewService],
})
export class DashboardModule {}
