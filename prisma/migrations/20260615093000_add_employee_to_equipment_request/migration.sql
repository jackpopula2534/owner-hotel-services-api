-- เบิกของ "ทีละคน": ผูกคำขอเบิกอุปกรณ์กับพนักงานที่จ้างแล้วรายคน (null = คำขอแบบเดิมระดับใบสรรหา)
-- AlterTable
ALTER TABLE `hr_equipment_requests` ADD COLUMN `employeeId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `hr_equipment_requests_employeeId_idx` ON `hr_equipment_requests`(`employeeId`);
