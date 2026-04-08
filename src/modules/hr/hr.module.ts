import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { HrMasterDataController } from './hr-master-data.controller';
import { HrMasterDataService } from './hr-master-data.service';
import { HrAttendanceController } from './hr-attendance.controller';
import { HrAttendanceService } from './hr-attendance.service';
import { HrLeaveController } from './hr-leave.controller';
import { HrLeaveService } from './hr-leave.service';
import { HrPayrollController } from './hr-payroll.controller';
import { HrPayrollService } from './hr-payroll.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';

// NOTE: EmployeeCodeConfigController has been intentionally merged into HrController
// to avoid NestJS route conflict where GET /hr/:id would intercept /hr/employee-code-config.
// Static sub-routes must always be declared BEFORE parameterized routes (:id) in the
// same controller to ensure correct resolution order.
//
// IMPORTANT: Sub-path controllers (hr/payroll, hr/leave, hr/attendance, hr/master-data)
// MUST be registered BEFORE HrController so NestJS matches their specific paths
// before HrController's @Get(':id') catches them as employee IDs.

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [
    HrMasterDataController,
    HrAttendanceController,
    HrLeaveController,
    HrPayrollController,
    HrController,  // Must be LAST — its @Get(':id') would catch sub-paths otherwise
  ],
  providers: [
    HrService,
    HrMasterDataService,
    HrAttendanceService,
    HrLeaveService,
    HrPayrollService,
    EmployeeCodeConfigService,
    HrAddonGuard,
  ],
  exports: [HrService, HrMasterDataService, HrAttendanceService, HrLeaveService, HrPayrollService, EmployeeCodeConfigService],
})
export class HrModule {}
