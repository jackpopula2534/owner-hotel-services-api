-- Phase 1: Operational HR Foundation
-- Shift roster, attendance exceptions, overtime approval, payroll policy engine.

-- ─── HrShiftAssignment ──────────────────────────────────────────────────────
CREATE TABLE `hr_shift_assignments` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `shiftTypeId` VARCHAR(191) NULL,
  `propertyId` VARCHAR(191) NULL,
  `departmentId` VARCHAR(191) NULL,
  `date` DATE NOT NULL,
  `startTime` VARCHAR(191) NULL,
  `endTime` VARCHAR(191) NULL,
  `isDayOff` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
  `note` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_shift_assignments_employeeId_date_key`(`employeeId`, `date`),
  INDEX `hr_shift_assignments_tenantId_idx`(`tenantId`),
  INDEX `hr_shift_assignments_employeeId_idx`(`employeeId`),
  INDEX `hr_shift_assignments_propertyId_idx`(`propertyId`),
  INDEX `hr_shift_assignments_departmentId_idx`(`departmentId`),
  INDEX `hr_shift_assignments_shiftTypeId_idx`(`shiftTypeId`),
  INDEX `hr_shift_assignments_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── HrWorkCalendar ─────────────────────────────────────────────────────────
CREATE TABLE `hr_work_calendars` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `propertyId` VARCHAR(191) NULL,
  `date` DATE NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'holiday',
  `isWorkingDay` BOOLEAN NOT NULL DEFAULT false,
  `payMultiplier` DECIMAL(4, 2) NOT NULL DEFAULT 1.00,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_work_calendars_tenantId_propertyId_date_key`(`tenantId`, `propertyId`, `date`),
  INDEX `hr_work_calendars_tenantId_idx`(`tenantId`),
  INDEX `hr_work_calendars_propertyId_idx`(`propertyId`),
  INDEX `hr_work_calendars_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── HrAttendanceException ──────────────────────────────────────────────────
CREATE TABLE `hr_attendance_exceptions` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `attendanceId` VARCHAR(191) NULL,
  `date` DATE NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `requestedCheckIn` DATETIME(3) NULL,
  `requestedCheckOut` DATETIME(3) NULL,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `reviewedBy` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewNote` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_attendance_exceptions_tenantId_idx`(`tenantId`),
  INDEX `hr_attendance_exceptions_employeeId_idx`(`employeeId`),
  INDEX `hr_attendance_exceptions_attendanceId_idx`(`attendanceId`),
  INDEX `hr_attendance_exceptions_status_idx`(`status`),
  INDEX `hr_attendance_exceptions_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── HrOvertimeRequest ──────────────────────────────────────────────────────
CREATE TABLE `hr_overtime_requests` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `attendanceId` VARCHAR(191) NULL,
  `date` DATE NOT NULL,
  `minutes` INTEGER NOT NULL,
  `multiplier` DECIMAL(4, 2) NOT NULL DEFAULT 1.50,
  `reason` TEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `approvedBy` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `rejectedBy` VARCHAR(191) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `reviewNote` TEXT NULL,
  `createdBy` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_overtime_requests_tenantId_idx`(`tenantId`),
  INDEX `hr_overtime_requests_employeeId_idx`(`employeeId`),
  INDEX `hr_overtime_requests_attendanceId_idx`(`attendanceId`),
  INDEX `hr_overtime_requests_status_idx`(`status`),
  INDEX `hr_overtime_requests_date_idx`(`date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── HrPayrollPolicy ────────────────────────────────────────────────────────
CREATE TABLE `hr_payroll_policies` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `propertyId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `payPeriod` VARCHAR(191) NOT NULL DEFAULT 'monthly',
  `cutoffDay` INTEGER NOT NULL DEFAULT 25,
  `payDay` INTEGER NOT NULL DEFAULT 30,
  `workingDaysPerMonth` INTEGER NOT NULL DEFAULT 30,
  `workingHoursPerDay` INTEGER NOT NULL DEFAULT 8,
  `otMultiplier` DECIMAL(4, 2) NOT NULL DEFAULT 1.50,
  `holidayOtMultiplier` DECIMAL(4, 2) NOT NULL DEFAULT 2.00,
  `otRequiresApproval` BOOLEAN NOT NULL DEFAULT true,
  `paidLeaveDeducted` BOOLEAN NOT NULL DEFAULT false,
  `unpaidLeaveRate` DECIMAL(4, 2) NOT NULL DEFAULT 1.00,
  `socialSecurityEnabled` BOOLEAN NOT NULL DEFAULT true,
  `socialSecurityRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.0500,
  `socialSecurityCap` DECIMAL(12, 2) NOT NULL DEFAULT 750.00,
  `taxEnabled` BOOLEAN NOT NULL DEFAULT false,
  `lateDeductionPerMin` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_payroll_policies_tenantId_propertyId_name_key`(`tenantId`, `propertyId`, `name`),
  INDEX `hr_payroll_policies_tenantId_idx`(`tenantId`),
  INDEX `hr_payroll_policies_propertyId_idx`(`propertyId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── HrPayroll: policy + period columns ─────────────────────────────────────
ALTER TABLE `hr_payrolls`
  ADD COLUMN `policyId` VARCHAR(191) NULL,
  ADD COLUMN `periodStart` DATE NULL,
  ADD COLUMN `periodEnd` DATE NULL;

-- ─── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE `hr_shift_assignments`
  ADD CONSTRAINT `hr_shift_assignments_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_shift_assignments_shiftTypeId_fkey` FOREIGN KEY (`shiftTypeId`) REFERENCES `hr_shift_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hr_attendance_exceptions`
  ADD CONSTRAINT `hr_attendance_exceptions_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_attendance_exceptions_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `hr_attendance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hr_overtime_requests`
  ADD CONSTRAINT `hr_overtime_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_overtime_requests_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `hr_attendance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
