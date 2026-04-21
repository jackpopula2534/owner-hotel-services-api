-- AlterTable
ALTER TABLE `employees` ADD COLUMN `bankAccount` VARCHAR(191) NULL,
    ADD COLUMN `baseSalary` DECIMAL(12, 2) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE `hr_attendance` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `checkIn` DATETIME(3) NULL,
    `checkOut` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'present',
    `workMinutes` INTEGER NULL,
    `overtimeMinutes` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_attendance_tenantId_idx`(`tenantId`),
    INDEX `hr_attendance_employeeId_idx`(`employeeId`),
    INDEX `hr_attendance_date_idx`(`date`),
    UNIQUE INDEX `hr_attendance_employeeId_date_key`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_leave_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `leaveTypeId` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `totalDays` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `rejectedBy` VARCHAR(191) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectReason` TEXT NULL,
    `substituteId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_leave_requests_tenantId_idx`(`tenantId`),
    INDEX `hr_leave_requests_employeeId_idx`(`employeeId`),
    INDEX `hr_leave_requests_leaveTypeId_idx`(`leaveTypeId`),
    INDEX `hr_leave_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_payrolls` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `baseSalary` DECIMAL(12, 2) NOT NULL,
    `totalAllowance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `totalDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `overtimePay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `bonusPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `netSalary` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_payrolls_tenantId_idx`(`tenantId`),
    INDEX `hr_payrolls_employeeId_idx`(`employeeId`),
    INDEX `hr_payrolls_month_year_idx`(`month`, `year`),
    UNIQUE INDEX `hr_payrolls_employeeId_month_year_key`(`employeeId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_payroll_items` (
    `id` VARCHAR(191) NOT NULL,
    `payrollId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hr_payroll_items_payrollId_idx`(`payrollId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_attendance` ADD CONSTRAINT `hr_attendance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_leave_requests` ADD CONSTRAINT `hr_leave_requests_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_leave_requests` ADD CONSTRAINT `hr_leave_requests_leaveTypeId_fkey` FOREIGN KEY (`leaveTypeId`) REFERENCES `hr_leave_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_payrolls` ADD CONSTRAINT `hr_payrolls_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_payroll_items` ADD CONSTRAINT `hr_payroll_items_payrollId_fkey` FOREIGN KEY (`payrollId`) REFERENCES `hr_payrolls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
