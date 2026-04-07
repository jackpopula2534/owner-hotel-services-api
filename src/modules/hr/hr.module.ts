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
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [
    HrController,
    HrMasterDataController,
    HrAttendanceController,
    HrLeaveController,
    HrPayrollController,
  ],
  providers: [
    HrService,
    HrMasterDataService,
    HrAttendanceService,
    HrLeaveService,
    HrPayrollService,
    HrAddonGuard,
  ],
  exports: [HrService, HrMasterDataService, HrAttendanceService, HrLeaveService, HrPayrollService],
})
export class HrModule {}
