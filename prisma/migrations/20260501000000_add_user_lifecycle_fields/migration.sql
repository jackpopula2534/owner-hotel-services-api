-- AlterTable: เพิ่ม fields สำหรับ user lifecycle management (expiration / suspend / deactivate)
ALTER TABLE `users`
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `suspendedAt` DATETIME(3) NULL,
    ADD COLUMN `suspendedBy` VARCHAR(36) NULL,
    ADD COLUMN `suspendedReason` TEXT NULL,
    ADD COLUMN `deactivatedAt` DATETIME(3) NULL,
    MODIFY `status` VARCHAR(20) NOT NULL DEFAULT 'active';

-- CreateIndex: ใช้สำหรับ scheduler ค้น user ที่ต้อง expire และ filter ตาม status
CREATE INDEX `users_status_expiresAt_idx` ON `users`(`status`, `expiresAt`);
CREATE INDEX `users_expiresAt_idx` ON `users`(`expiresAt`);
