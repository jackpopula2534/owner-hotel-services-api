import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { CostCentersModule } from './cost-centers/cost-centers.module';
import { CostTypesModule } from './cost-types/cost-types.module';
import { CostEntriesModule } from './cost-entries/cost-entries.module';
import { CostBudgetsModule } from './cost-budgets/cost-budgets.module';
import { PeriodCloseModule } from './period-close/period-close.module';
import { CostReportsModule } from './cost-reports/cost-reports.module';
import { WasteTrackingModule } from './waste-tracking/waste-tracking.module';
import { MenuEngineeringModule } from './menu-engineering/menu-engineering.module';
import { KpiSnapshotsModule } from './kpi-snapshots/kpi-snapshots.module';
import { DashboardWidgetsModule } from './dashboard-widgets/dashboard-widgets.module';
import { CostEventListener } from './events/cost-event.listener';

@Module({
  imports: [
    AddonModule,
    CostCentersModule,
    CostTypesModule,
    CostEntriesModule,
    CostBudgetsModule,
    PeriodCloseModule,
    CostReportsModule,
    WasteTrackingModule,
    MenuEngineeringModule,
    KpiSnapshotsModule,
    DashboardWidgetsModule,
  ],
  providers: [CostEventListener],
  exports: [
    CostCentersModule,
    CostTypesModule,
    CostEntriesModule,
    CostBudgetsModule,
    PeriodCloseModule,
    CostReportsModule,
    WasteTrackingModule,
    MenuEngineeringModule,
    KpiSnapshotsModule,
    DashboardWidgetsModule,
  ],
})
export class CostAccountingModule {}
