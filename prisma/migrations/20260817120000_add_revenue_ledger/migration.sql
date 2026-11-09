-- The central revenue ledger. One row per (source document × revenue type).
--
-- Revenue used to live nowhere in particular: every screen counted it straight
-- off whichever source table it happened to know about (orders, retail_sales,
-- bookings, camp_reservations), each with its own status filter and its own idea
-- of where a day starts. That is why the F&B report, the analytics dashboard and
-- cost accounting could show ฿2,129.40, ฿0 and ฿0 for the same month. This table
-- is the single place a sale is recognised, so those screens stop disagreeing.
--
-- Deliberately NOT the general ledger. The chart of accounts has to be seeded by
-- hand and accounting is a paid add-on, so a GL-only design shows ฿0 revenue to
-- every tenant without it. `revenue_entries` is always written; `journal_entries`
-- mirrors it later for tenants that do have a COA (journalEntryId stays NULL
-- until then). Reports read this table, financial statements read the GL.
--
-- Three details that are load-bearing:
--
-- 1. `businessDate` is DATE, holding UTC midnight of the Bangkok calendar day.
--    Storing a timestamp instead would push evening sales into the next day for
--    any server not on Asia/Bangkok, which is exactly the class of off-by-one-day
--    bug this table exists to end.
--
-- 2. The unique key includes `entryKind`. A cross-day void writes a REVERSAL row
--    carrying the same (sourceType, sourceId, revenueType) as the original, so
--    without a discriminator the reversal would collide with the row it reverses.
--    ORIGINAL rows stay unique per source document, which is what makes post()
--    idempotent under retry and backfill.
--
-- 3. Dimensions are columns, not something to be inferred from an account code.
--    `ledger_balances` has no outlet dimension at all, and a tenant without a COA
--    has no codes to infer from — "which restaurant earned this" has to be stored.
--
-- No foreign keys, on purpose: this is an append-only subledger that must never
-- lose a row because someone deleted the outlet or the source document. The
-- tenant-scope middleware enforces the tenantId boundary instead.

-- CreateTable
CREATE TABLE `revenue_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `businessDate` DATE NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `sourceModule` ENUM('HOTEL', 'RESTAURANT', 'RETAIL', 'CAMP') NOT NULL,
    `segment` ENUM('ROOMS', 'FOOD_BEVERAGE', 'OTHER_OPERATED') NOT NULL,
    `revenueType` ENUM('ROOM', 'FOOD', 'BEVERAGE', 'RETAIL_GOODS', 'SERVICE_CHARGE', 'OTHER') NOT NULL,
    `outletId` VARCHAR(191) NULL,
    `outletName` VARCHAR(191) NULL,
    `costCenterId` VARCHAR(191) NULL,
    `sourceType` ENUM('BOOKING', 'ORDER', 'RETAIL_SALE', 'CAMP_RESERVATION') NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `documentNo` VARCHAR(191) NULL,
    `grossAmount` DECIMAL(14, 2) NOT NULL,
    `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(14, 2) NOT NULL,
    `serviceCharge` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(14, 2) NOT NULL,
    `settlement` ENUM('CASH', 'TRANSFER', 'CARD', 'ROOM_CHARGE', 'CITY_LEDGER') NOT NULL,
    `folioChargeId` VARCHAR(191) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `accountCode` VARCHAR(191) NULL,
    `entryKind` ENUM('ORIGINAL', 'REVERSAL') NOT NULL DEFAULT 'ORIGINAL',
    `status` ENUM('POSTED', 'VOIDED') NOT NULL DEFAULT 'POSTED',
    `reversalOfId` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `revenue_entries_tenantId_businessDate_idx`(`tenantId`, `businessDate`),
    INDEX `revenue_entries_tenantId_sourceModule_businessDate_idx`(`tenantId`, `sourceModule`, `businessDate`),
    INDEX `revenue_entries_tenantId_segment_businessDate_idx`(`tenantId`, `segment`, `businessDate`),
    INDEX `revenue_entries_tenantId_outletId_businessDate_idx`(`tenantId`, `outletId`, `businessDate`),
    INDEX `revenue_entries_tenantId_journalEntryId_idx`(`tenantId`, `journalEntryId`),
    INDEX `revenue_entries_reversalOfId_idx`(`reversalOfId`),
    UNIQUE INDEX `revenue_entries_tenantId_sourceType_sourceId_revenueType_ent_key`(`tenantId`, `sourceType`, `sourceId`, `revenueType`, `entryKind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

