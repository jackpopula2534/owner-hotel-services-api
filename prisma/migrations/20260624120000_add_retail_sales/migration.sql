CREATE TABLE `retail_sales` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` ENUM('COMPLETED', 'VOIDED') NOT NULL DEFAULT 'COMPLETED',
    `paymentMethod` ENUM('CASH', 'QR', 'CARD', 'ROOM_CHARGE') NOT NULL DEFAULT 'CASH',
    `roomNumber` VARCHAR(191) NULL,
    `guestName` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `folioId` VARCHAR(191) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `grandTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `costTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `profitTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `soldBy` VARCHAR(191) NOT NULL,
    `soldAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `retail_sales_tenantId_idx`(`tenantId`),
    INDEX `retail_sales_warehouseId_idx`(`warehouseId`),
    INDEX `retail_sales_soldAt_idx`(`soldAt`),
    INDEX `retail_sales_paymentMethod_idx`(`paymentMethod`),
    INDEX `retail_sales_status_idx`(`status`),
    UNIQUE INDEX `retail_sales_tenantId_receiptNo_key`(`tenantId`, `receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retail_sale_items` (
    `id` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `lineDiscount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `lineTotal` DECIMAL(12, 2) NOT NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `lineCost` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `retail_sale_items_saleId_idx`(`saleId`),
    INDEX `retail_sale_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- AddForeignKey
ALTER TABLE `retail_sale_items` ADD CONSTRAINT `retail_sale_items_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `retail_sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

