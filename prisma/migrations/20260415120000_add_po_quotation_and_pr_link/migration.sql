-- CreateTable: Purchase Requisitions
CREATE TABLE `purchase_requisitions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `prNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_QUOTES', 'QUOTES_RECEIVED', 'COMPARING', 'PO_CREATED', 'CANCELLED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `requiredDate` DATETIME(3) NULL,
    `purpose` TEXT NULL,
    `department` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `internalNotes` TEXT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_requisitions_tenantId_prNumber_key`(`tenantId`, `prNumber`),
    INDEX `purchase_requisitions_tenantId_idx`(`tenantId`),
    INDEX `purchase_requisitions_propertyId_idx`(`propertyId`),
    INDEX `purchase_requisitions_status_idx`(`status`),
    INDEX `purchase_requisitions_requestedBy_idx`(`requestedBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Purchase Requisition Items
CREATE TABLE `purchase_requisition_items` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseRequisitionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `estimatedUnitPrice` DECIMAL(10, 2) NULL,
    `estimatedTotalPrice` DECIMAL(12, 2) NULL,
    `specifications` TEXT NULL,
    `preferredSupplierId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `purchase_requisition_items_purchaseRequisitionId_idx`(`purchaseRequisitionId`),
    INDEX `purchase_requisition_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Supplier Quotes
CREATE TABLE `supplier_quotes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `purchaseRequisitionId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `quoteNumber` VARCHAR(191) NULL,
    `status` ENUM('REQUESTED', 'RECEIVED', 'SELECTED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'REQUESTED',
    `quotedDate` DATETIME(3) NULL,
    `validUntil` DATETIME(3) NULL,
    `deliveryDays` INTEGER NULL,
    `paymentTerms` VARCHAR(191) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'THB',
    `notes` TEXT NULL,
    `attachmentUrl` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `receivedAt` DATETIME(3) NULL,
    `selectedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectionReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `supplier_quotes_tenantId_purchaseRequisitionId_supplierId_key`(`tenantId`, `purchaseRequisitionId`, `supplierId`),
    INDEX `supplier_quotes_tenantId_idx`(`tenantId`),
    INDEX `supplier_quotes_purchaseRequisitionId_idx`(`purchaseRequisitionId`),
    INDEX `supplier_quotes_supplierId_idx`(`supplierId`),
    INDEX `supplier_quotes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Supplier Quote Items
CREATE TABLE `supplier_quote_items` (
    `id` VARCHAR(191) NOT NULL,
    `supplierQuoteId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `discount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `totalPrice` DECIMAL(12, 2) NOT NULL,
    `leadTimeDays` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `supplier_quote_items_supplierQuoteId_idx`(`supplierQuoteId`),
    INDEX `supplier_quote_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: Price Comparisons
CREATE TABLE `price_comparisons` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `purchaseRequisitionId` VARCHAR(191) NOT NULL,
    `comparisonNumber` VARCHAR(191) NOT NULL,
    `selectedQuoteId` VARCHAR(191) NULL,
    `selectionReason` TEXT NULL,
    `comparedBy` VARCHAR(191) NOT NULL,
    `comparedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `price_comparisons_tenantId_comparisonNumber_key`(`tenantId`, `comparisonNumber`),
    INDEX `price_comparisons_tenantId_idx`(`tenantId`),
    INDEX `price_comparisons_purchaseRequisitionId_idx`(`purchaseRequisitionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: Add quotation reference and PR link to purchase_orders
ALTER TABLE `purchase_orders` ADD COLUMN `quotationNumber` VARCHAR(191) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `quotationDate` DATETIME(3) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `purchaseRequisitionId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `purchase_orders_purchaseRequisitionId_idx` ON `purchase_orders`(`purchaseRequisitionId`);

-- AddForeignKey: purchase_requisition_items -> purchase_requisitions
ALTER TABLE `purchase_requisition_items` ADD CONSTRAINT `purchase_requisition_items_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: purchase_requisition_items -> inventory_items
ALTER TABLE `purchase_requisition_items` ADD CONSTRAINT `purchase_requisition_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: supplier_quotes -> purchase_requisitions
ALTER TABLE `supplier_quotes` ADD CONSTRAINT `supplier_quotes_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: supplier_quotes -> suppliers
ALTER TABLE `supplier_quotes` ADD CONSTRAINT `supplier_quotes_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: supplier_quote_items -> supplier_quotes
ALTER TABLE `supplier_quote_items` ADD CONSTRAINT `supplier_quote_items_supplierQuoteId_fkey` FOREIGN KEY (`supplierQuoteId`) REFERENCES `supplier_quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: supplier_quote_items -> inventory_items
ALTER TABLE `supplier_quote_items` ADD CONSTRAINT `supplier_quote_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: price_comparisons -> purchase_requisitions
ALTER TABLE `price_comparisons` ADD CONSTRAINT `price_comparisons_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: price_comparisons -> supplier_quotes
ALTER TABLE `price_comparisons` ADD CONSTRAINT `price_comparisons_selectedQuoteId_fkey` FOREIGN KEY (`selectedQuoteId`) REFERENCES `supplier_quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: purchase_orders -> purchase_requisitions
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
