-- รายการ Statement ธนาคารที่นำเข้า ใช้ร่วมกันระหว่างรับชำระ (AR) และกระทบยอดธนาคาร
CREATE TABLE `bank_statement_lines` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `bankAccountId` VARCHAR(191) NOT NULL,
    `txnDate` DATE NOT NULL,
    `txnTime` VARCHAR(8) NULL,
    `description` VARCHAR(300) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `balance` DECIMAL(14, 2) NULL,
    `reference` VARCHAR(100) NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `status` ENUM('UNMATCHED', 'MATCHED', 'IGNORED') NOT NULL DEFAULT 'UNMATCHED',
    `journalLineId` VARCHAR(191) NULL,
    `arReceiptId` VARCHAR(191) NULL,
    `importBatchId` VARCHAR(40) NOT NULL,
    `sourceFile` VARCHAR(200) NULL,
    `importedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bank_statement_lines_tenantId_bankAccountId_fingerprint_key`(`tenantId`, `bankAccountId`, `fingerprint`),
    INDEX `bank_stmt_lines_tenant_prop_acct_date_idx`(`tenantId`, `propertyId`, `bankAccountId`, `txnDate`),
    INDEX `bank_statement_lines_status_idx`(`status`),
    INDEX `bank_statement_lines_journalLineId_idx`(`journalLineId`),
    INDEX `bank_statement_lines_arReceiptId_idx`(`arReceiptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
