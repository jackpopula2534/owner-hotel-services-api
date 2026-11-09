-- สิทธิ์เข้าใช้ต่อระบบย่อย (terminal) แยกออกจาก blob ใน users
--
-- เดิมสิทธิ์กระจายอยู่ใน users.allowedSystems (สตริง JSON หนึ่งช่อง) + users.role
-- (บทบาทเดียวทั้งที่คนหนึ่งเข้าได้หลายระบบ) + procurementPermissions /
-- warehousePermissions / warehouseIds — ขยายไม่ได้และ query ไม่ได้
-- ตารางนี้เก็บ "ใครเข้าระบบไหน บทบาทอะไร สิทธิ์อะไร" หนึ่งแถวต่อ (user, terminal)
--
-- users.allowedSystems ยังต้องอยู่และถูก sync ทุกครั้งที่เขียนตารางนี้ เพราะ
-- SystemGuard กับ auth.service ยังอ่านฟิลด์นั้นตอน login
-- backfill จากข้อมูลเดิม: npm run users:backfill-access
CREATE TABLE `user_terminal_access` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `terminal` VARCHAR(32) NOT NULL,
    `role` VARCHAR(64) NOT NULL,
    `permissions` JSON NULL,
    `approvalLimit` DECIMAL(12, 2) NULL,
    `scopeIds` JSON NULL,
    `grantedBy` VARCHAR(191) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `user_terminal_access_userId_terminal_key`(`userId`, `terminal`),
    INDEX `user_terminal_access_tenantId_terminal_idx`(`tenantId`, `terminal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_terminal_access`
  ADD CONSTRAINT `user_terminal_access_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
