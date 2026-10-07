-- โปรโมชั่น Retail Phase 2: ระบบหยุดโปรอัตโนมัติเมื่อของแถมหมด (โปรที่ไม่มีส่วนลด)
-- แผน: docs/RETAIL_PROMOTIONS_PLAN.md

-- AlterTable
ALTER TABLE `retail_promotions` ADD COLUMN `autoPausedAt` DATETIME(3) NULL,
    ADD COLUMN `pausedReason` VARCHAR(255) NULL;
