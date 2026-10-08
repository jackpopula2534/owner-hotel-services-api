-- ซื้อเงินสด (cash purchase) ใน goods_receives + ไฟล์แนบสลิป
-- schema ถูกแก้ใน commit 08ce807 แต่ไม่เคยมี migration → endpoint ซื้อเงินสดพังบน DB ที่สร้างจาก migrations
-- AlterTable
ALTER TABLE `goods_receives` ADD COLUMN `hasNoReceipt` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `paidBy` VARCHAR(191) NULL,
    ADD COLUMN `paymentMethod` ENUM('PETTY_CASH', 'OWN_MONEY', 'TRANSFER', 'CARD') NULL,
    ADD COLUMN `purchaseRequisitionId` VARCHAR(191) NULL,
    ADD COLUMN `source` ENUM('PURCHASE_ORDER', 'CASH_PURCHASE') NOT NULL DEFAULT 'PURCHASE_ORDER',
    ADD COLUMN `supplierId` VARCHAR(191) NULL,
    ADD COLUMN `vendorName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `goods_receive_attachments` (
    `id` VARCHAR(191) NOT NULL,
    `goodsReceiveId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `kind` ENUM('SLIP', 'PHOTO', 'OTHER') NOT NULL DEFAULT 'SLIP',
    `storageKey` VARCHAR(500) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `originalName` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `uploadedBy` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `goods_receive_attachments_goodsReceiveId_idx`(`goodsReceiveId`),
    INDEX `goods_receive_attachments_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `goods_receives_tenantId_source_idx` ON `goods_receives`(`tenantId`, `source`);

-- CreateIndex
CREATE INDEX `goods_receives_supplierId_idx` ON `goods_receives`(`supplierId`);

-- CreateIndex
CREATE INDEX `goods_receives_purchaseRequisitionId_idx` ON `goods_receives`(`purchaseRequisitionId`);

-- AddForeignKey
ALTER TABLE `goods_receives` ADD CONSTRAINT `goods_receives_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receives` ADD CONSTRAINT `goods_receives_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receive_attachments` ADD CONSTRAINT `goods_receive_attachments_goodsReceiveId_fkey` FOREIGN KEY (`goodsReceiveId`) REFERENCES `goods_receives`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

