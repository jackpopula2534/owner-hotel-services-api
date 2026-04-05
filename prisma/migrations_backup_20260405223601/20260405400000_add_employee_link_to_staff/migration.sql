-- Migration: add_employee_link_to_staff
-- Adds optional HR Add-on link from Staff → Employee
-- Part of HR_MODULE add-on feature (Phase 4 — HR Integration)

-- Step 1: Add employeeId column (nullable, unique)
ALTER TABLE `staff`
  ADD COLUMN `employeeId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `staff_employeeId_key` (`employeeId`),
  ADD INDEX `staff_employeeId_idx` (`employeeId`);

-- Step 2: Add foreign key constraint (SetNull on Employee delete)
ALTER TABLE `staff`
  ADD CONSTRAINT `staff_employeeId_fkey`
  FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
