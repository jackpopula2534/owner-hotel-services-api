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
import { HrPerformanceController } from './hr-performance.controller';
import { HrPerformanceService } from './hr-performance.service';
import { HrKpiTemplateController } from './hr-kpi-template.controller';
import { HrKpiTemplateService } from './hr-kpi-template.service';
import { HrEvaluationCycleController } from './hr-evaluation-cycle.controller';
import { HrEvaluationCycleService } from './hr-evaluation-cycle.service';
import { HrShiftController } from './hr-shift.controller';
import { HrShiftService } from './hr-shift.service';
import { HrAttendanceExceptionController } from './hr-attendance-exception.controller';
import { HrAttendanceExceptionService } from './hr-attendance-exception.service';
import { HrOvertimeController } from './hr-overtime.controller';
import { HrOvertimeService } from './hr-overtime.service';
import { HrPayrollPolicyController } from './hr-payroll-policy.controller';
import { HrPayrollPolicyService } from './hr-payroll-policy.service';
import { HrEmployeeDocumentController } from './hr-employee-document.controller';
import { HrEmployeeDocumentService } from './hr-employee-document.service';
import { HrOnboardingController, HrProbationController } from './hr-lifecycle.controller';
import { HrOnboardingService } from './hr-onboarding.service';
import { HrProbationService } from './hr-probation.service';
import { HrLifecycleSetupController } from './hr-lifecycle-setup.controller';
import { HrLifecycleSetupService } from './hr-lifecycle-setup.service';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';
import { HrLeavePolicyController } from './hr-leave-policy.controller';
import { HrLeavePolicyService } from './hr-leave-policy.service';
import { HrOffboardingController } from './hr-offboarding.controller';
import { HrOffboardingService } from './hr-offboarding.service';
import { HrTrainingController } from './hr-training.controller';
import { HrTrainingService } from './hr-training.service';
import { HrSelfServiceController, HrAnalyticsController } from './hr-experience.controller';
import { HrSelfServiceService } from './hr-self-service.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { HrCompletenessService } from './hr-completeness.service';
import { HrEquipmentIssuanceController } from './hr-equipment-issuance.controller';
import { HrEquipmentIssuanceService } from './hr-equipment-issuance.service';
import { RecruitmentInventoryService } from './recruitment-inventory.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { IntegrationsModule } from '../integrations/integrations.module';
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
  imports: [PrismaModule, AddonModule, IntegrationsModule],
  controllers: [
    HrMasterDataController,
    HrAttendanceController,
    HrShiftController, // P1-02: shift roster + work calendar
    HrAttendanceExceptionController, // P1-03: attendance exceptions
    HrOvertimeController, // P1-05: overtime approval
    HrLeavePolicyController, // P2-05: leave policy
    HrLeaveController,
    HrEmployeeDocumentController, // P2-01: employee documents
    HrLifecycleSetupController, // lifecycle setup + requirements foundation
    HrOnboardingController, // P2-03: onboarding checklist
    HrProbationController, // probation rounds + checkpoints (2026-06-10 redesign)
    HrEquipmentIssuanceController, // stage 6: first-day equipment issuance
    HrOffboardingController, // P2-06/07: offboarding + clearance
    HrTrainingController, // P3-03: training/certification
    HrSelfServiceController, // P3-01/02: self-service
    HrAnalyticsController, // P3-04: workforce analytics
    HrPayrollPolicyController, // P1-06: payroll policy config
    HrPayrollController,
    HrPerformanceController,
    HrKpiTemplateController, // NEW: KPI Template CRUD
    HrEvaluationCycleController, // NEW: Evaluation Cycle + auto-generate
    HrController, // Must be LAST — its @Get(':id') would catch sub-paths otherwise
  ],
  providers: [
    HrService,
    HrMasterDataService,
    HrAttendanceService,
    HrShiftService, // P1-02
    HrAttendanceExceptionService, // P1-03
    HrOvertimeService, // P1-05
    HrLeavePolicyService, // P2-05
    HrLeaveService,
    HrEmployeeDocumentService, // P2-01
    HrLifecycleSetupService,
    HrLifecycleAssignmentService,
    HrOnboardingService, // P2-03
    HrProbationService, // P2-04
    HrOffboardingService, // P2-06/07
    HrTrainingService, // P3-03
    HrSelfServiceService, // P3-01/02
    HrAnalyticsService, // P3-04
    HrPayrollPolicyService, // P1-06
    HrPayrollService,
    HrPerformanceService,
    HrKpiTemplateService, // NEW
    HrEvaluationCycleService, // NEW
    HrEquipmentIssuanceService,
    RecruitmentInventoryService,
    EmployeeCodeConfigService,
    HrCompletenessService,
    HrAddonGuard,
  ],
  exports: [
    HrService,
    HrMasterDataService,
    HrAttendanceService,
    HrShiftService,
    HrAttendanceExceptionService,
    HrOvertimeService,
    HrLeavePolicyService,
    HrLeaveService,
    HrEmployeeDocumentService,
    HrLifecycleSetupService,
    HrLifecycleAssignmentService,
    HrOnboardingService,
    HrProbationService,
    HrEquipmentIssuanceService,
    RecruitmentInventoryService,
    HrOffboardingService,
    HrTrainingService,
    HrSelfServiceService,
    HrAnalyticsService,
    HrPayrollPolicyService,
    HrPayrollService,
    HrPerformanceService,
    HrKpiTemplateService,
    HrEvaluationCycleService,
    EmployeeCodeConfigService,
  ],
})
export class HrModule {}
