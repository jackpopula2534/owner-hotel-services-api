-- AlterTable: การจองหลายห้องในครั้งเดียว (หน้าเว็บ) ผูกกันด้วย bookingGroupId เดียวกัน
ALTER TABLE `bookings` ADD COLUMN `bookingGroupId` VARCHAR(36) NULL;

-- CreateIndex
CREATE INDEX `bookings_bookingGroupId_idx` ON `bookings`(`bookingGroupId`);
