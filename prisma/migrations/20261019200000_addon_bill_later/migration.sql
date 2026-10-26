-- AlterTable: add-on แบบใช้ก่อน เก็บเงินรอบบิลถัดไป
ALTER TABLE `subscription_features`
    ADD COLUMN `billing_mode` VARCHAR(20) NULL,
    ADD COLUMN `activated_at` DATETIME(3) NULL,
    ADD COLUMN `billing_starts_on` DATE NULL,
    ADD COLUMN `billed_through` DATE NULL,
    ADD COLUMN `committed_until` DATE NULL,
    ADD COLUMN `cancel_at` DATE NULL,
    ADD COLUMN `accepted_at` DATETIME(3) NULL,
    ADD COLUMN `accepted_by` VARCHAR(36) NULL;
