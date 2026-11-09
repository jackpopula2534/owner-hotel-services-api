-- ค่าตอบแทน 2 ชุดในข้อเสนอจ้าง (ช่วงทดลองงาน / หลังผ่านทดลองงาน)
ALTER TABLE `hr_hire_records`
  ADD COLUMN `probationPositionBonus` DECIMAL(12, 2) NULL,
  ADD COLUMN `probationAllowance` DECIMAL(12, 2) NULL,
  ADD COLUMN `postProbationSalary` DECIMAL(12, 2) NULL,
  ADD COLUMN `postProbationPositionBonus` DECIMAL(12, 2) NULL,
  ADD COLUMN `postProbationAllowance` DECIMAL(12, 2) NULL;

-- ประวัติค่าตอบแทน
CREATE TABLE `hr_compensation_changes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `effectiveDate` DATE NULL,
    `baseSalary` DECIMAL(12, 2) NOT NULL,
    `positionBonus` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `allowance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `previous` JSON NULL,
    `changeType` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `refType` VARCHAR(191) NULL,
    `refId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `appliedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_compensation_changes_tenantId_employeeId_effectiveDate_idx`(`tenantId`, `employeeId`, `effectiveDate`),
    INDEX `hr_compensation_changes_status_effectiveDate_idx`(`status`, `effectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_compensation_changes` ADD CONSTRAINT `hr_compensation_changes_employeeId_fkey`
  FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ยกยอด: พนักงานเดิมที่มีเงินเดือนแล้ว = แถว IMPORT 1 แถว (มีผลตั้งแต่วันเริ่มงาน)
INSERT INTO `hr_compensation_changes`
  (`id`, `tenantId`, `employeeId`, `effectiveDate`, `baseSalary`, `positionBonus`, `allowance`,
   `changeType`, `source`, `reason`, `status`, `appliedAt`, `createdAt`, `updatedAt`)
SELECT UUID(), e.`tenantId`, e.`id`, DATE(COALESCE(e.`startDate`, e.`createdAt`)),
       e.`baseSalary`, COALESCE(e.`positionBonus`, 0), COALESCE(e.`allowance`, 0),
       'IMPORT', 'system', 'ยกยอดจากข้อมูลพนักงานเดิม', 'applied', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `employees` e
WHERE e.`baseSalary` IS NOT NULL AND e.`tenantId` IS NOT NULL;
