-- กลุ่มคลัง: กำหนดว่าคลังไปแสดงที่ระบบไหน (เช่น POS หน้าร้าน)
-- คลังที่ไม่มีกลุ่มยังแสดงทุกระบบเหมือนเดิม

-- CreateTable
CREATE TABLE `warehouse_groups` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NULL,
    `channels` JSON NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `warehouse_groups_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `warehouse_groups_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `warehouses` ADD COLUMN `groupId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `warehouses_groupId_idx` ON `warehouses`(`groupId`);

-- AddForeignKey
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `warehouse_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
