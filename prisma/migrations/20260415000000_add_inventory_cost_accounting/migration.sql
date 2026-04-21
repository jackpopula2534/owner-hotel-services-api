-- CreateTable
CREATE TABLE `warehouses` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` ENUM('GENERAL', 'KITCHEN', 'HOUSEKEEPING', 'MAINTENANCE', 'MINIBAR') NOT NULL DEFAULT 'GENERAL',
    `location` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `warehouses_tenantId_idx`(`tenantId`),
    INDEX `warehouses_propertyId_idx`(`propertyId`),
    INDEX `warehouses_deletedAt_idx`(`deletedAt`),
    UNIQUE INDEX `warehouses_tenantId_propertyId_code_key`(`tenantId`, `propertyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_categories` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `parentId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `item_categories_tenantId_idx`(`tenantId`),
    INDEX `item_categories_parentId_idx`(`parentId`),
    UNIQUE INDEX `item_categories_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_items` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `categoryId` VARCHAR(191) NULL,
    `unit` ENUM('PIECE', 'BOX', 'PACK', 'KG', 'G', 'L', 'ML', 'BOTTLE', 'CAN', 'BAG', 'ROLL', 'SET', 'PAIR', 'SHEET', 'METER', 'DOZEN') NOT NULL DEFAULT 'PIECE',
    `costMethod` ENUM('FIFO', 'WEIGHTED_AVG') NOT NULL DEFAULT 'WEIGHTED_AVG',
    `reorderPoint` INTEGER NOT NULL DEFAULT 0,
    `reorderQty` INTEGER NOT NULL DEFAULT 0,
    `maxStock` INTEGER NULL,
    `minStock` INTEGER NOT NULL DEFAULT 0,
    `barcode` VARCHAR(191) NULL,
    `brand` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `isPerishable` BOOLEAN NOT NULL DEFAULT false,
    `defaultShelfLifeDays` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `inventory_items_tenantId_idx`(`tenantId`),
    INDEX `inventory_items_categoryId_idx`(`categoryId`),
    INDEX `inventory_items_barcode_idx`(`barcode`),
    INDEX `inventory_items_deletedAt_idx`(`deletedAt`),
    UNIQUE INDEX `inventory_items_tenantId_sku_key`(`tenantId`, `sku`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `contactPerson` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `taxId` VARCHAR(191) NULL,
    `paymentTerms` VARCHAR(191) NULL,
    `leadTimeDays` INTEGER NULL,
    `rating` DECIMAL(3, 2) NULL,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `suppliers_tenantId_idx`(`tenantId`),
    INDEX `suppliers_deletedAt_idx`(`deletedAt`),
    UNIQUE INDEX `suppliers_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'THB',
    `minOrderQty` INTEGER NULL,
    `leadDays` INTEGER NULL,
    `isPreferred` BOOLEAN NOT NULL DEFAULT false,
    `lastOrderDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `item_suppliers_itemId_idx`(`itemId`),
    INDEX `item_suppliers_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `item_suppliers_itemId_supplierId_key`(`itemId`, `supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warehouse_stocks` (
    `id` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `avgCost` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lastCountedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `warehouse_stocks_warehouseId_idx`(`warehouseId`),
    INDEX `warehouse_stocks_itemId_idx`(`itemId`),
    UNIQUE INDEX `warehouse_stocks_warehouseId_itemId_key`(`warehouseId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movements` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `type` ENUM('GOODS_RECEIVE', 'GOODS_ISSUE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RETURN_SUPPLIER', 'WASTE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL,
    `referenceType` VARCHAR(191) NULL,
    `referenceId` VARCHAR(191) NULL,
    `transferWarehouseId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `expiryDate` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_tenantId_idx`(`tenantId`),
    INDEX `stock_movements_warehouseId_idx`(`warehouseId`),
    INDEX `stock_movements_itemId_idx`(`itemId`),
    INDEX `stock_movements_type_idx`(`type`),
    INDEX `stock_movements_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
    INDEX `stock_movements_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `poNumber` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedDate` DATETIME(3) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'THB',
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

    INDEX `purchase_orders_tenantId_idx`(`tenantId`),
    INDEX `purchase_orders_propertyId_idx`(`propertyId`),
    INDEX `purchase_orders_supplierId_idx`(`supplierId`),
    INDEX `purchase_orders_status_idx`(`status`),
    INDEX `purchase_orders_orderDate_idx`(`orderDate`),
    UNIQUE INDEX `purchase_orders_tenantId_poNumber_key`(`tenantId`, `poNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_items` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `receivedQty` INTEGER NOT NULL DEFAULT 0,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `discount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `totalPrice` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `purchase_order_items_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `purchase_order_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receives` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `grNumber` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'INSPECTING', 'ACCEPTED', 'PARTIAL_REJECT', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `receiveDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `invoiceNumber` VARCHAR(191) NULL,
    `invoiceDate` DATETIME(3) NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `receivedBy` VARCHAR(191) NOT NULL,
    `inspectedBy` VARCHAR(191) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `goods_receives_tenantId_idx`(`tenantId`),
    INDEX `goods_receives_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `goods_receives_warehouseId_idx`(`warehouseId`),
    INDEX `goods_receives_receiveDate_idx`(`receiveDate`),
    UNIQUE INDEX `goods_receives_tenantId_grNumber_key`(`tenantId`, `grNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receive_items` (
    `id` VARCHAR(191) NOT NULL,
    `goodsReceiveId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `orderedQty` INTEGER NULL,
    `receivedQty` INTEGER NOT NULL,
    `rejectedQty` INTEGER NOT NULL DEFAULT 0,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `expiryDate` DATETIME(3) NULL,
    `rejectReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `goods_receive_items_goodsReceiveId_idx`(`goodsReceiveId`),
    INDEX `goods_receive_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_counts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `countNumber` VARCHAR(191) NOT NULL,
    `countDate` DATETIME(3) NOT NULL,
    `status` ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'APPROVED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
    `countType` VARCHAR(191) NOT NULL DEFAULT 'full',
    `notes` TEXT NULL,
    `totalVariance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `totalItems` INTEGER NOT NULL DEFAULT 0,
    `countedItems` INTEGER NOT NULL DEFAULT 0,
    `varianceItems` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stock_counts_tenantId_idx`(`tenantId`),
    INDEX `stock_counts_warehouseId_idx`(`warehouseId`),
    INDEX `stock_counts_status_idx`(`status`),
    INDEX `stock_counts_countDate_idx`(`countDate`),
    UNIQUE INDEX `stock_counts_tenantId_countNumber_key`(`tenantId`, `countNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_items` (
    `id` VARCHAR(191) NOT NULL,
    `stockCountId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `systemQty` INTEGER NOT NULL,
    `actualQty` INTEGER NULL,
    `variance` INTEGER NULL,
    `varianceValue` DECIMAL(12, 2) NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `notes` TEXT NULL,
    `countedBy` VARCHAR(191) NULL,
    `countedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stock_count_items_stockCountId_idx`(`stockCountId`),
    INDEX `stock_count_items_itemId_idx`(`itemId`),
    UNIQUE INDEX `stock_count_items_stockCountId_itemId_key`(`stockCountId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_sequences` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `docType` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL,
    `yearMonth` VARCHAR(191) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `document_sequences_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `document_sequences_tenantId_docType_yearMonth_key`(`tenantId`, `docType`, `yearMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_type_amenity_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `roomType` VARCHAR(191) NOT NULL,
    `taskType` VARCHAR(191) NOT NULL DEFAULT 'checkout',
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `warehouseId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `room_type_amenity_templates_tenantId_idx`(`tenantId`),
    INDEX `room_type_amenity_templates_roomType_idx`(`roomType`),
    INDEX `room_type_amenity_templates_taskType_idx`(`taskType`),
    UNIQUE INDEX `room_type_amenity_templates_tenantId_roomType_taskType_itemI_key`(`tenantId`, `roomType`, `taskType`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_recipes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `menuItemName` VARCHAR(191) NOT NULL,
    `servings` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `inventory_recipes_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `inventory_recipes_tenantId_menuItemId_key`(`tenantId`, `menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_recipe_ingredients` (
    `id` VARCHAR(191) NOT NULL,
    `recipeId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `wastagePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_recipe_ingredients_recipeId_idx`(`recipeId`),
    INDEX `inventory_recipe_ingredients_itemId_idx`(`itemId`),
    UNIQUE INDEX `inventory_recipe_ingredients_recipeId_itemId_key`(`recipeId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_centers` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` ENUM('ROOMS', 'FOOD_BEVERAGE', 'ADMIN_GENERAL', 'SALES_MARKETING', 'MAINTENANCE_DEPT', 'ENERGY', 'OTHER_OPERATED', 'UNDISTRIBUTED') NOT NULL,
    `description` TEXT NULL,
    `parentId` VARCHAR(191) NULL,
    `managerId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cost_centers_tenantId_idx`(`tenantId`),
    INDEX `cost_centers_propertyId_idx`(`propertyId`),
    INDEX `cost_centers_type_idx`(`type`),
    UNIQUE INDEX `cost_centers_tenantId_propertyId_code_key`(`tenantId`, `propertyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_types` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `category` ENUM('MATERIAL', 'LABOR', 'OVERHEAD', 'REVENUE', 'OTHER') NOT NULL,
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cost_types_tenantId_idx`(`tenantId`),
    INDEX `cost_types_category_idx`(`category`),
    UNIQUE INDEX `cost_types_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `costCenterId` VARCHAR(191) NOT NULL,
    `costTypeId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'THB',
    `period` VARCHAR(191) NOT NULL,
    `entryDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` TEXT NULL,
    `sourceType` VARCHAR(191) NULL,
    `sourceId` VARCHAR(191) NULL,
    `isAutoPosted` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'posted',
    `reversedById` VARCHAR(191) NULL,
    `reversedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cost_entries_tenantId_idx`(`tenantId`),
    INDEX `cost_entries_propertyId_idx`(`propertyId`),
    INDEX `cost_entries_costCenterId_idx`(`costCenterId`),
    INDEX `cost_entries_costTypeId_idx`(`costTypeId`),
    INDEX `cost_entries_period_idx`(`period`),
    INDEX `cost_entries_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `cost_entries_entryDate_idx`(`entryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `period_closes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'CLOSING', 'CLOSED', 'REOPENED') NOT NULL DEFAULT 'OPEN',
    `totalRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalMaterialCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalLaborCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalOverhead` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalOtherCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `grossProfit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `netOperatingIncome` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalRoomNights` INTEGER NOT NULL DEFAULT 0,
    `occupiedRoomNights` INTEGER NOT NULL DEFAULT 0,
    `occupancyRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `revPAR` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `costPerOccupiedRoom` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `reopenedBy` VARCHAR(191) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `period_closes_tenantId_idx`(`tenantId`),
    INDEX `period_closes_propertyId_idx`(`propertyId`),
    INDEX `period_closes_status_idx`(`status`),
    UNIQUE INDEX `period_closes_tenantId_propertyId_year_month_key`(`tenantId`, `propertyId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_pnls` (
    `id` VARCHAR(191) NOT NULL,
    `periodCloseId` VARCHAR(191) NOT NULL,
    `costCenterId` VARCHAR(191) NOT NULL,
    `revenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `materialCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `laborCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `overheadCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `otherCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `netProfit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `profitMargin` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_pnls_periodCloseId_idx`(`periodCloseId`),
    INDEX `department_pnls_costCenterId_idx`(`costCenterId`),
    UNIQUE INDEX `department_pnls_periodCloseId_costCenterId_key`(`periodCloseId`, `costCenterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_cost_analyses` (
    `id` VARCHAR(191) NOT NULL,
    `periodCloseId` VARCHAR(191) NOT NULL,
    `roomType` VARCHAR(191) NOT NULL,
    `totalNights` INTEGER NOT NULL DEFAULT 0,
    `totalRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `amenityCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `laborCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `revenuePerNight` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `costPerNight` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `profitPerNight` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `margin` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_cost_analyses_periodCloseId_idx`(`periodCloseId`),
    UNIQUE INDEX `room_cost_analyses_periodCloseId_roomType_key`(`periodCloseId`, `roomType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `food_cost_analyses` (
    `id` VARCHAR(191) NOT NULL,
    `periodCloseId` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `menuItemName` VARCHAR(191) NOT NULL,
    `quantitySold` INTEGER NOT NULL DEFAULT 0,
    `totalRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `ingredientCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `costPerUnit` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `foodCostPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `profitPerUnit` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `food_cost_analyses_periodCloseId_idx`(`periodCloseId`),
    UNIQUE INDEX `food_cost_analyses_periodCloseId_menuItemId_key`(`periodCloseId`, `menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_budgets` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `propertyId` VARCHAR(36) NOT NULL,
    `costCenterId` VARCHAR(36) NOT NULL,
    `costTypeId` VARCHAR(36) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `budgetAmount` DECIMAL(14, 2) NOT NULL,
    `actualAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `variance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `variancePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cost_budgets_tenantId_idx`(`tenantId`),
    INDEX `cost_budgets_propertyId_idx`(`propertyId`),
    INDEX `cost_budgets_period_idx`(`period`),
    UNIQUE INDEX `cost_budgets_tenantId_propertyId_costCenterId_costTypeId_per_key`(`tenantId`, `propertyId`, `costCenterId`, `costTypeId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `menu_engineering_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NULL,
    `period` VARCHAR(191) NOT NULL,
    `snapshotDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `avgPopularity` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `avgMargin` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalItems` INTEGER NOT NULL DEFAULT 0,
    `starsCount` INTEGER NOT NULL DEFAULT 0,
    `plowhorsesCount` INTEGER NOT NULL DEFAULT 0,
    `puzzlesCount` INTEGER NOT NULL DEFAULT 0,
    `dogsCount` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `menu_engineering_snapshots_tenantId_idx`(`tenantId`),
    INDEX `menu_engineering_snapshots_propertyId_idx`(`propertyId`),
    UNIQUE INDEX `menu_engineering_snapshots_tenantId_propertyId_period_key`(`tenantId`, `propertyId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `menu_engineering_items` (
    `id` VARCHAR(191) NOT NULL,
    `snapshotId` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `menuItemName` VARCHAR(191) NOT NULL,
    `categoryName` VARCHAR(191) NULL,
    `quantitySold` INTEGER NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(10, 2) NOT NULL,
    `ingredientCost` DECIMAL(10, 2) NOT NULL,
    `contributionMargin` DECIMAL(10, 2) NOT NULL,
    `marginPercent` DECIMAL(5, 2) NOT NULL,
    `totalRevenue` DECIMAL(14, 2) NOT NULL,
    `totalCost` DECIMAL(14, 2) NOT NULL,
    `totalProfit` DECIMAL(14, 2) NOT NULL,
    `popularityIndex` DECIMAL(5, 2) NOT NULL,
    `classification` VARCHAR(191) NOT NULL,
    `recommendation` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `menu_engineering_items_snapshotId_idx`(`snapshotId`),
    INDEX `menu_engineering_items_classification_idx`(`classification`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `waste_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `estimatedCost` DECIMAL(10, 2) NOT NULL,
    `reason` ENUM('EXPIRED', 'SPOILED', 'OVERPRODUCTION', 'PLATE_WASTE', 'PREPARATION', 'DAMAGED', 'OTHER') NOT NULL,
    `department` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `wasteDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `stockMovementId` VARCHAR(191) NULL,
    `recordedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `waste_records_tenantId_idx`(`tenantId`),
    INDEX `waste_records_propertyId_idx`(`propertyId`),
    INDEX `waste_records_itemId_idx`(`itemId`),
    INDEX `waste_records_reason_idx`(`reason`),
    INDEX `waste_records_wasteDate_idx`(`wasteDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_kpi_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `snapshotDate` DATETIME(3) NOT NULL,
    `granularity` VARCHAR(191) NOT NULL DEFAULT 'daily',
    `totalRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `roomRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `fbRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `otherRevenue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `materialCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `laborCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `overheadCost` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `grossProfit` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `gopAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `gopPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `occupancyRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `adr` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `revPAR` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `costPOR` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `foodCostPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `beverageCostPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `inventoryValue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `lowStockAlerts` INTEGER NOT NULL DEFAULT 0,
    `outOfStockItems` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cost_kpi_snapshots_tenantId_idx`(`tenantId`),
    INDEX `cost_kpi_snapshots_propertyId_idx`(`propertyId`),
    INDEX `cost_kpi_snapshots_snapshotDate_idx`(`snapshotDate`),
    INDEX `cost_kpi_snapshots_granularity_idx`(`granularity`),
    UNIQUE INDEX `cost_kpi_snapshots_tenantId_propertyId_snapshotDate_granular_key`(`tenantId`, `propertyId`, `snapshotDate`, `granularity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `warehouses` ADD CONSTRAINT `warehouses_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_categories` ADD CONSTRAINT `item_categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `item_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `item_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_suppliers` ADD CONSTRAINT `item_suppliers_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_suppliers` ADD CONSTRAINT `item_suppliers_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouse_stocks` ADD CONSTRAINT `warehouse_stocks_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warehouse_stocks` ADD CONSTRAINT `warehouse_stocks_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receives` ADD CONSTRAINT `goods_receives_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receives` ADD CONSTRAINT `goods_receives_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receive_items` ADD CONSTRAINT `goods_receive_items_goodsReceiveId_fkey` FOREIGN KEY (`goodsReceiveId`) REFERENCES `goods_receives`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receive_items` ADD CONSTRAINT `goods_receive_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_counts` ADD CONSTRAINT `stock_counts_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_stockCountId_fkey` FOREIGN KEY (`stockCountId`) REFERENCES `stock_counts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_items` ADD CONSTRAINT `stock_count_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_type_amenity_templates` ADD CONSTRAINT `room_type_amenity_templates_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_recipe_ingredients` ADD CONSTRAINT `inventory_recipe_ingredients_recipeId_fkey` FOREIGN KEY (`recipeId`) REFERENCES `inventory_recipes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_recipe_ingredients` ADD CONSTRAINT `inventory_recipe_ingredients_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_centers` ADD CONSTRAINT `cost_centers_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `cost_centers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_entries` ADD CONSTRAINT `cost_entries_costCenterId_fkey` FOREIGN KEY (`costCenterId`) REFERENCES `cost_centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_entries` ADD CONSTRAINT `cost_entries_costTypeId_fkey` FOREIGN KEY (`costTypeId`) REFERENCES `cost_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_pnls` ADD CONSTRAINT `department_pnls_periodCloseId_fkey` FOREIGN KEY (`periodCloseId`) REFERENCES `period_closes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_pnls` ADD CONSTRAINT `department_pnls_costCenterId_fkey` FOREIGN KEY (`costCenterId`) REFERENCES `cost_centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_cost_analyses` ADD CONSTRAINT `room_cost_analyses_periodCloseId_fkey` FOREIGN KEY (`periodCloseId`) REFERENCES `period_closes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_cost_analyses` ADD CONSTRAINT `food_cost_analyses_periodCloseId_fkey` FOREIGN KEY (`periodCloseId`) REFERENCES `period_closes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_budgets` ADD CONSTRAINT `cost_budgets_costCenterId_fkey` FOREIGN KEY (`costCenterId`) REFERENCES `cost_centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_budgets` ADD CONSTRAINT `cost_budgets_costTypeId_fkey` FOREIGN KEY (`costTypeId`) REFERENCES `cost_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_engineering_items` ADD CONSTRAINT `menu_engineering_items_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `menu_engineering_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `waste_records` ADD CONSTRAINT `waste_records_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

