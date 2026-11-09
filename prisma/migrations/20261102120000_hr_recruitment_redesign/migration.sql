-- HR recruitment redesign (ขอกำลังพล): เหตุผลแบบมีโครงสร้าง, เตือนผู้อนุมัติ,
-- รายละเอียดนัดสัมภาษณ์/คะแนนรายหัวข้อ, อัตรากำลัง+งบบุคลากรของแผนก, ชุดอุปกรณ์ตามตำแหน่ง
ALTER TABLE `hr_manpower_requests`
    ADD COLUMN `reasonType` VARCHAR(191) NULL,
    ADD COLUMN `replacementEmployeeIds` JSON NULL,
    ADD COLUMN `lastRemindedAt` DATETIME(3) NULL;

ALTER TABLE `hr_interviews`
    ADD COLUMN `durationMinutes` INTEGER NOT NULL DEFAULT 45,
    ADD COLUMN `format` VARCHAR(191) NULL,
    ADD COLUMN `ratings` JSON NULL,
    ADD COLUMN `candidateNotifiedAt` DATETIME(3) NULL;

ALTER TABLE `hr_departments`
    ADD COLUMN `plannedHeadcount` INTEGER NULL,
    ADD COLUMN `annualPersonnelBudget` DECIMAL(14, 2) NULL;

ALTER TABLE `hr_positions`
    ADD COLUMN `equipmentKit` JSON NULL;
