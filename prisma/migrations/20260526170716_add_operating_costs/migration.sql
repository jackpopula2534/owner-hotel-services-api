-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `bookingNo` VARCHAR(30) NULL;

-- AlterTable
ALTER TABLE `payments` MODIFY `method` ENUM('transfer', 'qr', 'cash', 'stripe', 'truemoney') NOT NULL;

-- CreateTable
CREATE TABLE `conversations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `pictureUrl` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastMessageAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `conversations_tenantId_channel_idx`(`tenantId`, `channel`),
    INDEX `conversations_tenantId_lastMessageAt_idx`(`tenantId`, `lastMessageAt`),
    UNIQUE INDEX `conversations_tenantId_channel_externalId_key`(`tenantId`, `channel`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `direction` VARCHAR(191) NOT NULL,
    `messageType` VARCHAR(191) NOT NULL DEFAULT 'text',
    `content` TEXT NOT NULL,
    `externalMsgId` VARCHAR(191) NULL,
    `staffId` VARCHAR(191) NULL,
    `isAutoReply` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_conversationId_idx`(`conversationId`),
    INDEX `messages_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auto_reply_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `triggerType` VARCHAR(191) NOT NULL DEFAULT 'KEYWORD',
    `keywords` JSON NULL,
    `replyText` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `auto_reply_templates_tenantId_channel_isActive_idx`(`tenantId`, `channel`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_customers` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stripeCustomerId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `stripe_customers_tenantId_key`(`tenantId`),
    UNIQUE INDEX `stripe_customers_stripeCustomerId_key`(`stripeCustomerId`),
    INDEX `stripe_customers_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_payment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripePaymentIntentId` VARCHAR(191) NOT NULL,
    `stripeClientSecret` TEXT NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'thb',
    `status` VARCHAR(50) NOT NULL,
    `paymentMethodId` VARCHAR(191) NULL,
    `receiptUrl` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `stripe_payment_intents_stripePaymentIntentId_key`(`stripePaymentIntentId`),
    INDEX `stripe_payment_intents_tenantId_idx`(`tenantId`),
    INDEX `stripe_payment_intents_invoiceId_idx`(`invoiceId`),
    INDEX `stripe_payment_intents_stripePaymentIntentId_idx`(`stripePaymentIntentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `truemoney_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `merchantOrderId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'THB',
    `status` VARCHAR(50) NOT NULL,
    `paymentToken` TEXT NULL,
    `redirectUrl` TEXT NULL,
    `callbackData` JSON NULL,
    `paidAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `truemoney_transactions_merchantOrderId_key`(`merchantOrderId`),
    INDEX `truemoney_transactions_tenantId_idx`(`tenantId`),
    INDEX `truemoney_transactions_invoiceId_idx`(`invoiceId`),
    INDEX `truemoney_transactions_merchantOrderId_idx`(`merchantOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fiscal_years` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fiscal_years_tenantId_idx`(`tenantId`),
    INDEX `fiscal_years_propertyId_idx`(`propertyId`),
    INDEX `fiscal_years_status_idx`(`status`),
    UNIQUE INDEX `fiscal_years_tenantId_propertyId_year_key`(`tenantId`, `propertyId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_charts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `nameEn` VARCHAR(200) NULL,
    `type` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
    `subType` VARCHAR(50) NULL,
    `normalBalance` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `level` ENUM('CATEGORY', 'GROUP', 'ACCOUNT', 'SUB_ACCOUNT') NOT NULL DEFAULT 'ACCOUNT',
    `parentId` VARCHAR(191) NULL,
    `isControl` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isHeaderOnly` BOOLEAN NOT NULL DEFAULT false,
    `fsCode` VARCHAR(20) NULL,
    `description` TEXT NULL,
    `costCenterId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `account_charts_tenantId_idx`(`tenantId`),
    INDEX `account_charts_type_idx`(`type`),
    INDEX `account_charts_parentId_idx`(`parentId`),
    INDEX `account_charts_isActive_idx`(`isActive`),
    UNIQUE INDEX `account_charts_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `entryNo` VARCHAR(30) NOT NULL,
    `entryDate` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `sourceType` ENUM('MANUAL', 'BOOKING_PAYMENT', 'FOLIO_CHARGE', 'AR_RECEIPT', 'AP_PAYMENT', 'NIGHT_AUDIT', 'DEPRECIATION', 'PAYROLL', 'PURCHASE_RECEIPT', 'TAX_FILING', 'CLOSING_ENTRY', 'ADJUSTMENT') NOT NULL DEFAULT 'MANUAL',
    `sourceId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'POSTED', 'REVERSED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `fiscalYearId` VARCHAR(191) NULL,
    `fiscalPeriod` INTEGER NOT NULL,
    `fiscalYear` INTEGER NOT NULL,
    `totalDebit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `totalCredit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `postedBy` VARCHAR(191) NULL,
    `postedAt` DATETIME(3) NULL,
    `reversedById` VARCHAR(191) NULL,
    `reversedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `journal_entries_tenantId_idx`(`tenantId`),
    INDEX `journal_entries_propertyId_idx`(`propertyId`),
    INDEX `journal_entries_entryDate_idx`(`entryDate`),
    INDEX `journal_entries_fiscalYear_fiscalPeriod_idx`(`fiscalYear`, `fiscalPeriod`),
    INDEX `journal_entries_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `journal_entries_status_idx`(`status`),
    UNIQUE INDEX `journal_entries_tenantId_entryNo_key`(`tenantId`, `entryNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` VARCHAR(191) NOT NULL,
    `journalEntryId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `description` VARCHAR(300) NULL,
    `debit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `credit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `costCenterId` VARCHAR(191) NULL,
    `subRef` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `journal_lines_journalEntryId_idx`(`journalEntryId`),
    INDEX `journal_lines_accountId_idx`(`accountId`),
    INDEX `journal_lines_costCenterId_idx`(`costCenterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_balances` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `fiscalYearId` VARCHAR(191) NULL,
    `fiscalYear` INTEGER NOT NULL,
    `fiscalPeriod` INTEGER NOT NULL,
    `openingBalance` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `periodDebit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `periodCredit` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `closingBalance` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `txnCount` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ledger_balances_tenantId_idx`(`tenantId`),
    INDEX `ledger_balances_propertyId_idx`(`propertyId`),
    INDEX `ledger_balances_accountId_idx`(`accountId`),
    INDEX `ledger_balances_fiscalYear_fiscalPeriod_idx`(`fiscalYear`, `fiscalPeriod`),
    UNIQUE INDEX `ledger_balances_tenantId_propertyId_accountId_fiscalYear_fis_key`(`tenantId`, `propertyId`, `accountId`, `fiscalYear`, `fiscalPeriod`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ar_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `invoiceType` ENUM('GUEST_BILL', 'CITY_LEDGER', 'ADVANCE_DEPOSIT', 'CREDIT_NOTE', 'PROFORMA') NOT NULL DEFAULT 'GUEST_BILL',
    `guestId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `folioId` VARCHAR(191) NULL,
    `companyName` VARCHAR(200) NULL,
    `companyTaxId` VARCHAR(20) NULL,
    `companyAddress` TEXT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `taxableAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `whtAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `status` ENUM('DRAFT', 'ISSUED', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'THB',
    `exchangeRate` DECIMAL(12, 6) NOT NULL DEFAULT 1.000000,
    `notes` TEXT NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `postedBy` VARCHAR(191) NULL,
    `issuedBy` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ar_invoices_tenantId_idx`(`tenantId`),
    INDEX `ar_invoices_propertyId_idx`(`propertyId`),
    INDEX `ar_invoices_guestId_idx`(`guestId`),
    INDEX `ar_invoices_bookingId_idx`(`bookingId`),
    INDEX `ar_invoices_folioId_idx`(`folioId`),
    INDEX `ar_invoices_status_idx`(`status`),
    INDEX `ar_invoices_issueDate_idx`(`issueDate`),
    INDEX `ar_invoices_dueDate_idx`(`dueDate`),
    UNIQUE INDEX `ar_invoices_tenantId_invoiceNo_key`(`tenantId`, `invoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ar_invoice_lines` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `chargeType` ENUM('ROOM_CHARGE', 'FB_CHARGE', 'SERVICE_CHARGE', 'TELEPHONE', 'LAUNDRY', 'SPA', 'MINIBAR', 'PARKING', 'TRANSPORT', 'EXTRA_BED', 'EARLY_CHECKIN', 'LATE_CHECKOUT', 'DAMAGE', 'DEPOSIT_APPLIED', 'DISCOUNT', 'TAX', 'SERVICE_FEE', 'ADJUSTMENT', 'OTHER') NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1.00,
    `unitPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountAmt` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `accountId` VARCHAR(191) NULL,
    `costCenterId` VARCHAR(191) NULL,
    `sourceRef` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ar_invoice_lines_invoiceId_idx`(`invoiceId`),
    INDEX `ar_invoice_lines_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guest_folios` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `folioNo` VARCHAR(30) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `guestId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NULL,
    `checkInDate` DATE NOT NULL,
    `checkOutDate` DATE NULL,
    `openDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('OPEN', 'CLOSED', 'VOID', 'PENDING') NOT NULL DEFAULT 'OPEN',
    `totalCharges` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalPayments` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `depositAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'THB',
    `notes` TEXT NULL,
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `guest_folios_tenantId_idx`(`tenantId`),
    INDEX `guest_folios_propertyId_idx`(`propertyId`),
    INDEX `guest_folios_bookingId_idx`(`bookingId`),
    INDEX `guest_folios_guestId_idx`(`guestId`),
    INDEX `guest_folios_status_idx`(`status`),
    UNIQUE INDEX `guest_folios_tenantId_folioNo_key`(`tenantId`, `folioNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `folio_charges` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `folioId` VARCHAR(191) NOT NULL,
    `chargeDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `chargeType` ENUM('ROOM_CHARGE', 'FB_CHARGE', 'SERVICE_CHARGE', 'TELEPHONE', 'LAUNDRY', 'SPA', 'MINIBAR', 'PARKING', 'TRANSPORT', 'EXTRA_BED', 'EARLY_CHECKIN', 'LATE_CHECKOUT', 'DAMAGE', 'DEPOSIT_APPLIED', 'DISCOUNT', 'TAX', 'SERVICE_FEE', 'ADJUSTMENT', 'OTHER') NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1.00,
    `unitPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `accountId` VARCHAR(191) NULL,
    `costCenterId` VARCHAR(191) NULL,
    `nightAuditId` VARCHAR(191) NULL,
    `sourceType` VARCHAR(50) NULL,
    `sourceId` VARCHAR(191) NULL,
    `isAutoPosted` BOOLEAN NOT NULL DEFAULT false,
    `isReversed` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('POSTED', 'REVERSED', 'VOID') NOT NULL DEFAULT 'POSTED',
    `reversedById` VARCHAR(191) NULL,
    `reversedBy` VARCHAR(191) NULL,
    `reversedAt` DATETIME(3) NULL,
    `postedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `folio_charges_folioId_idx`(`folioId`),
    INDEX `folio_charges_chargeDate_idx`(`chargeDate`),
    INDEX `folio_charges_chargeType_idx`(`chargeType`),
    INDEX `folio_charges_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    INDEX `folio_charges_nightAuditId_idx`(`nightAuditId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `folio_payments` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `folioId` VARCHAR(191) NOT NULL,
    `paymentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'QR_PROMPTPAY', 'TRUEMONEY', 'CHEQUE', 'CREDIT_NOTE', 'ADVANCE', 'CITY_LEDGER', 'ONLINE_BOOKING', 'OTHER') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `payerName` VARCHAR(200) NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'CLEARED', 'VOID') NOT NULL DEFAULT 'CLEARED',
    `isReversed` BOOLEAN NOT NULL DEFAULT false,
    `postedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `folio_payments_folioId_idx`(`folioId`),
    INDEX `folio_payments_paymentDate_idx`(`paymentDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ar_receipts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(30) NOT NULL,
    `receiptDate` DATE NOT NULL,
    `guestId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'CLEARED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `companyName` VARCHAR(200) NULL,
    `companyTaxId` VARCHAR(20) NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'QR_PROMPTPAY', 'TRUEMONEY', 'CHEQUE', 'CREDIT_NOTE', 'ADVANCE', 'CITY_LEDGER', 'ONLINE_BOOKING', 'OTHER') NOT NULL,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ar_receipts_tenantId_idx`(`tenantId`),
    INDEX `ar_receipts_propertyId_idx`(`propertyId`),
    INDEX `ar_receipts_receiptDate_idx`(`receiptDate`),
    INDEX `ar_receipts_guestId_idx`(`guestId`),
    UNIQUE INDEX `ar_receipts_tenantId_receiptNo_key`(`tenantId`, `receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ar_receipt_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `receiptId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ar_receipt_allocations_receiptId_idx`(`receiptId`),
    INDEX `ar_receipt_allocations_invoiceId_idx`(`invoiceId`),
    UNIQUE INDEX `ar_receipt_allocations_receiptId_invoiceId_key`(`receiptId`, `invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ap_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `supplierInvoiceNo` VARCHAR(100) NULL,
    `invoiceType` ENUM('SUPPLIER_INVOICE', 'UTILITY_BILL', 'RENT', 'SERVICE_CONTRACT', 'CREDIT_NOTE') NOT NULL DEFAULT 'SUPPLIER_INVOICE',
    `supplierId` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `goodsReceiveId` VARCHAR(191) NULL,
    `invoiceDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `taxableAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `whtAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netPayable` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `status` ENUM('PENDING', 'APPROVED', 'PARTIAL', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID') NOT NULL DEFAULT 'PENDING',
    `currency` VARCHAR(3) NOT NULL DEFAULT 'THB',
    `exchangeRate` DECIMAL(12, 6) NOT NULL DEFAULT 1.000000,
    `paymentTerms` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `internalNotes` TEXT NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ap_invoices_tenantId_idx`(`tenantId`),
    INDEX `ap_invoices_propertyId_idx`(`propertyId`),
    INDEX `ap_invoices_supplierId_idx`(`supplierId`),
    INDEX `ap_invoices_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `ap_invoices_status_idx`(`status`),
    INDEX `ap_invoices_dueDate_idx`(`dueDate`),
    UNIQUE INDEX `ap_invoices_tenantId_invoiceNo_key`(`tenantId`, `invoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ap_invoice_lines` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1.00,
    `unitPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `discountAmt` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `whtRate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `whtAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `accountId` VARCHAR(191) NULL,
    `costCenterId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ap_invoice_lines_invoiceId_idx`(`invoiceId`),
    INDEX `ap_invoice_lines_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ap_payments` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `paymentNo` VARCHAR(30) NOT NULL,
    `paymentDate` DATE NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'QR_PROMPTPAY', 'TRUEMONEY', 'CHEQUE', 'CREDIT_NOTE', 'ADVANCE', 'CITY_LEDGER', 'ONLINE_BOOKING', 'OTHER') NOT NULL,
    `grossAmount` DECIMAL(12, 2) NOT NULL,
    `whtAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netAmount` DECIMAL(12, 2) NOT NULL,
    `bankAccountId` VARCHAR(191) NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ap_payments_tenantId_idx`(`tenantId`),
    INDEX `ap_payments_propertyId_idx`(`propertyId`),
    INDEX `ap_payments_supplierId_idx`(`supplierId`),
    INDEX `ap_payments_paymentDate_idx`(`paymentDate`),
    INDEX `ap_payments_status_idx`(`status`),
    UNIQUE INDEX `ap_payments_tenantId_paymentNo_key`(`tenantId`, `paymentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ap_payment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ap_payment_allocations_paymentId_idx`(`paymentId`),
    INDEX `ap_payment_allocations_invoiceId_idx`(`invoiceId`),
    UNIQUE INDEX `ap_payment_allocations_paymentId_invoiceId_key`(`paymentId`, `invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_rates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `type` ENUM('VAT', 'WHT_INDIVIDUAL', 'WHT_JURISTIC', 'SPECIFIC_BUSINESS') NOT NULL,
    `rate` DECIMAL(5, 2) NOT NULL,
    `taxPayableAccountId` VARCHAR(191) NULL,
    `taxInputAccountId` VARCHAR(191) NULL,
    `whtIncomeType` ENUM('TYPE_40_2', 'TYPE_40_3', 'TYPE_40_4', 'TYPE_40_5', 'TYPE_40_6', 'TYPE_40_7', 'TYPE_40_8') NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tax_rates_tenantId_idx`(`tenantId`),
    INDEX `tax_rates_type_idx`(`type`),
    UNIQUE INDEX `tax_rates_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wht_certificates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `certNo` VARCHAR(30) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `apPaymentId` VARCHAR(191) NULL,
    `paymentDate` DATE NOT NULL,
    `incomeType` ENUM('TYPE_40_2', 'TYPE_40_3', 'TYPE_40_4', 'TYPE_40_5', 'TYPE_40_6', 'TYPE_40_7', 'TYPE_40_8') NOT NULL,
    `incomeAmount` DECIMAL(12, 2) NOT NULL,
    `whtRate` DECIMAL(5, 2) NOT NULL,
    `whtAmount` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `payeeName` VARCHAR(200) NOT NULL,
    `payeeTaxId` VARCHAR(20) NULL,
    `payeeAddress` TEXT NULL,
    `issuerName` VARCHAR(200) NULL,
    `issuerTaxId` VARCHAR(20) NULL,
    `issuedBy` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `wht_certificates_tenantId_idx`(`tenantId`),
    INDEX `wht_certificates_propertyId_idx`(`propertyId`),
    INDEX `wht_certificates_supplierId_idx`(`supplierId`),
    INDEX `wht_certificates_paymentDate_idx`(`paymentDate`),
    INDEX `wht_certificates_status_idx`(`status`),
    UNIQUE INDEX `wht_certificates_tenantId_certNo_key`(`tenantId`, `certNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_filings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `filingType` ENUM('VAT_PP30', 'WHT_PND1', 'WHT_PND3', 'WHT_PND53', 'CIT_PND51', 'CIT_PND50') NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `taxYear` INTEGER NOT NULL,
    `taxMonth` INTEGER NOT NULL,
    `totalBase` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `totalTax` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `paidAmount` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `status` ENUM('DRAFT', 'READY', 'FILED', 'PAID', 'AMENDED') NOT NULL DEFAULT 'DRAFT',
    `dueDate` DATE NOT NULL,
    `filedAt` DATETIME(3) NULL,
    `filedBy` VARCHAR(191) NULL,
    `paidAt` DATETIME(3) NULL,
    `paidBy` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `filingRef` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tax_filings_tenantId_idx`(`tenantId`),
    INDEX `tax_filings_propertyId_idx`(`propertyId`),
    INDEX `tax_filings_filingType_idx`(`filingType`),
    INDEX `tax_filings_period_idx`(`period`),
    INDEX `tax_filings_status_idx`(`status`),
    UNIQUE INDEX `tax_filings_tenantId_propertyId_filingType_period_key`(`tenantId`, `propertyId`, `filingType`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_filing_lines` (
    `id` VARCHAR(191) NOT NULL,
    `filingId` VARCHAR(191) NOT NULL,
    `lineNo` INTEGER NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `docRef` VARCHAR(100) NULL,
    `baseAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tax_filing_lines_filingId_idx`(`filingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `night_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `auditDate` DATE NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `roomRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `fbRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `otherRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalCharges` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalPayments` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalRooms` INTEGER NOT NULL DEFAULT 0,
    `occupiedRooms` INTEGER NOT NULL DEFAULT 0,
    `occupancyRate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `adr` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `revPAR` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `checkInsCount` INTEGER NOT NULL DEFAULT 0,
    `checkOutsCount` INTEGER NOT NULL DEFAULT 0,
    `startedBy` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedBy` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `night_audits_tenantId_idx`(`tenantId`),
    INDEX `night_audits_propertyId_idx`(`propertyId`),
    INDEX `night_audits_auditDate_idx`(`auditDate`),
    INDEX `night_audits_status_idx`(`status`),
    UNIQUE INDEX `night_audits_tenantId_propertyId_auditDate_key`(`tenantId`, `propertyId`, `auditDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `night_audit_charges` (
    `id` VARCHAR(191) NOT NULL,
    `nightAuditId` VARCHAR(191) NOT NULL,
    `folioId` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NULL,
    `chargeType` ENUM('ROOM_CHARGE', 'FB_CHARGE', 'SERVICE_CHARGE', 'TELEPHONE', 'LAUNDRY', 'SPA', 'MINIBAR', 'PARKING', 'TRANSPORT', 'EXTRA_BED', 'EARLY_CHECKIN', 'LATE_CHECKOUT', 'DAMAGE', 'DEPOSIT_APPLIED', 'DISCOUNT', 'TAX', 'SERVICE_FEE', 'ADJUSTMENT', 'OTHER') NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `vatAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `night_audit_charges_nightAuditId_idx`(`nightAuditId`),
    INDEX `night_audit_charges_folioId_idx`(`folioId`),
    INDEX `night_audit_charges_bookingId_idx`(`bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_drawers` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `openingBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `currentBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `status` ENUM('OPEN', 'CLOSED', 'PENDING') NOT NULL DEFAULT 'OPEN',
    `openedBy` VARCHAR(191) NULL,
    `openedAt` DATETIME(3) NULL,
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `countedAmount` DECIMAL(12, 2) NULL,
    `variance` DECIMAL(12, 2) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cash_drawers_tenantId_idx`(`tenantId`),
    INDEX `cash_drawers_propertyId_idx`(`propertyId`),
    INDEX `cash_drawers_status_idx`(`status`),
    UNIQUE INDEX `cash_drawers_tenantId_propertyId_code_key`(`tenantId`, `propertyId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `drawerId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `txnDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `txnType` ENUM('RECEIPT', 'PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'OPENING', 'CLOSING') NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balance` DECIMAL(12, 2) NOT NULL,
    `toDrawerId` VARCHAR(191) NULL,
    `sourceType` VARCHAR(50) NULL,
    `sourceId` VARCHAR(191) NULL,
    `reference` VARCHAR(100) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_transactions_drawerId_idx`(`drawerId`),
    INDEX `cash_transactions_tenantId_idx`(`tenantId`),
    INDEX `cash_transactions_txnDate_idx`(`txnDate`),
    INDEX `cash_transactions_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_reconciliations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `statementDate` DATE NOT NULL,
    `statementBalance` DECIMAL(14, 2) NOT NULL,
    `bookBalance` DECIMAL(14, 2) NOT NULL,
    `variance` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'APPROVED') NOT NULL DEFAULT 'OPEN',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bank_reconciliations_tenantId_idx`(`tenantId`),
    INDEX `bank_reconciliations_propertyId_idx`(`propertyId`),
    INDEX `bank_reconciliations_bankAccountId_idx`(`bankAccountId`),
    INDEX `bank_reconciliations_status_idx`(`status`),
    UNIQUE INDEX `bank_reconciliations_tenantId_propertyId_bankAccountId_perio_key`(`tenantId`, `propertyId`, `bankAccountId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_recon_lines` (
    `id` VARCHAR(191) NOT NULL,
    `reconId` VARCHAR(191) NOT NULL,
    `txnType` VARCHAR(20) NOT NULL,
    `txnDate` DATE NOT NULL,
    `description` VARCHAR(300) NOT NULL,
    `statementAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `bookAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `isMatched` BOOLEAN NOT NULL DEFAULT false,
    `matchedAt` DATETIME(3) NULL,
    `bookRef` VARCHAR(100) NULL,
    `statementRef` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bank_recon_lines_reconId_idx`(`reconId`),
    INDEX `bank_recon_lines_txnDate_idx`(`txnDate`),
    INDEX `bank_recon_lines_isMatched_idx`(`isMatched`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `assetCode` VARCHAR(30) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` ENUM('LAND', 'BUILDING', 'BUILDING_IMPROVE', 'FURNITURE', 'EQUIPMENT', 'IT_EQUIPMENT', 'VEHICLE', 'LINEN_UNIFORM', 'KITCHEN_EQUIPMENT', 'OTHER') NOT NULL,
    `costCenterId` VARCHAR(191) NULL,
    `assetAccountId` VARCHAR(191) NULL,
    `accumDeprecAccountId` VARCHAR(191) NULL,
    `deprecExpenseAccountId` VARCHAR(191) NULL,
    `purchaseDate` DATE NOT NULL,
    `purchaseCost` DECIMAL(14, 2) NOT NULL,
    `acquisitionCost` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `residualValue` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `usefulLifeYears` INTEGER NOT NULL,
    `depreciationMethod` ENUM('STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_ACTIVITY', 'SUM_OF_YEARS', 'NO_DEPRECIATION') NOT NULL DEFAULT 'STRAIGHT_LINE',
    `depreciationRate` DECIMAL(5, 2) NULL,
    `accumulatedDepreciation` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `bookValue` DECIMAL(14, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'IDLE', 'UNDER_REPAIR', 'DISPOSED', 'WRITTEN_OFF') NOT NULL DEFAULT 'ACTIVE',
    `location` VARCHAR(200) NULL,
    `serialNo` VARCHAR(100) NULL,
    `responsiblePerson` VARCHAR(191) NULL,
    `purchaseOrderId` VARCHAR(191) NULL,
    `disposalDate` DATE NULL,
    `disposalAmount` DECIMAL(14, 2) NULL,
    `disposedBy` VARCHAR(191) NULL,
    `disposalReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fixed_assets_tenantId_idx`(`tenantId`),
    INDEX `fixed_assets_propertyId_idx`(`propertyId`),
    INDEX `fixed_assets_category_idx`(`category`),
    INDEX `fixed_assets_status_idx`(`status`),
    INDEX `fixed_assets_costCenterId_idx`(`costCenterId`),
    UNIQUE INDEX `fixed_assets_tenantId_assetCode_key`(`tenantId`, `assetCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asset_depreciations` (
    `id` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(10) NOT NULL,
    `fiscalYear` INTEGER NOT NULL,
    `fiscalPeriod` INTEGER NOT NULL,
    `depreciationDate` DATE NOT NULL,
    `depreciationAmount` DECIMAL(14, 2) NOT NULL,
    `accumulatedAmount` DECIMAL(14, 2) NOT NULL,
    `bookValue` DECIMAL(14, 2) NOT NULL,
    `journalEntryId` VARCHAR(191) NULL,
    `isPosted` BOOLEAN NOT NULL DEFAULT false,
    `postedAt` DATETIME(3) NULL,
    `postedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `asset_depreciations_assetId_idx`(`assetId`),
    INDEX `asset_depreciations_tenantId_idx`(`tenantId`),
    INDEX `asset_depreciations_period_idx`(`period`),
    INDEX `asset_depreciations_isPosted_idx`(`isPosted`),
    UNIQUE INDEX `asset_depreciations_assetId_period_key`(`assetId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stripe_payment_intents` ADD CONSTRAINT `stripe_payment_intents_stripeCustomerId_fkey` FOREIGN KEY (`stripeCustomerId`) REFERENCES `stripe_customers`(`stripeCustomerId`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_charts` ADD CONSTRAINT `account_charts_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `account_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_fiscalYearId_fkey` FOREIGN KEY (`fiscalYearId`) REFERENCES `fiscal_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversedById_fkey` FOREIGN KEY (`reversedById`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `journal_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `account_charts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_balances` ADD CONSTRAINT `ledger_balances_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `account_charts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_balances` ADD CONSTRAINT `ledger_balances_fiscalYearId_fkey` FOREIGN KEY (`fiscalYearId`) REFERENCES `fiscal_years`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_invoices` ADD CONSTRAINT `ar_invoices_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_invoices` ADD CONSTRAINT `ar_invoices_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_invoices` ADD CONSTRAINT `ar_invoices_folioId_fkey` FOREIGN KEY (`folioId`) REFERENCES `guest_folios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_invoice_lines` ADD CONSTRAINT `ar_invoice_lines_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `ar_invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_invoice_lines` ADD CONSTRAINT `ar_invoice_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `account_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_folios` ADD CONSTRAINT `guest_folios_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guest_folios` ADD CONSTRAINT `guest_folios_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folio_charges` ADD CONSTRAINT `folio_charges_folioId_fkey` FOREIGN KEY (`folioId`) REFERENCES `guest_folios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folio_payments` ADD CONSTRAINT `folio_payments_folioId_fkey` FOREIGN KEY (`folioId`) REFERENCES `guest_folios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_receipts` ADD CONSTRAINT `ar_receipts_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_receipt_allocations` ADD CONSTRAINT `ar_receipt_allocations_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `ar_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ar_receipt_allocations` ADD CONSTRAINT `ar_receipt_allocations_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `ar_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_invoices` ADD CONSTRAINT `ap_invoices_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_invoice_lines` ADD CONSTRAINT `ap_invoice_lines_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `ap_invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_invoice_lines` ADD CONSTRAINT `ap_invoice_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `account_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_payments` ADD CONSTRAINT `ap_payments_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_payment_allocations` ADD CONSTRAINT `ap_payment_allocations_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `ap_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ap_payment_allocations` ADD CONSTRAINT `ap_payment_allocations_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `ap_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_rates` ADD CONSTRAINT `tax_rates_taxPayableAccountId_fkey` FOREIGN KEY (`taxPayableAccountId`) REFERENCES `account_charts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wht_certificates` ADD CONSTRAINT `wht_certificates_apPaymentId_fkey` FOREIGN KEY (`apPaymentId`) REFERENCES `ap_payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wht_certificates` ADD CONSTRAINT `wht_certificates_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tax_filing_lines` ADD CONSTRAINT `tax_filing_lines_filingId_fkey` FOREIGN KEY (`filingId`) REFERENCES `tax_filings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `night_audit_charges` ADD CONSTRAINT `night_audit_charges_nightAuditId_fkey` FOREIGN KEY (`nightAuditId`) REFERENCES `night_audits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_transactions` ADD CONSTRAINT `cash_transactions_drawerId_fkey` FOREIGN KEY (`drawerId`) REFERENCES `cash_drawers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_recon_lines` ADD CONSTRAINT `bank_recon_lines_reconId_fkey` FOREIGN KEY (`reconId`) REFERENCES `bank_reconciliations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asset_depreciations` ADD CONSTRAINT `asset_depreciations_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `fixed_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
