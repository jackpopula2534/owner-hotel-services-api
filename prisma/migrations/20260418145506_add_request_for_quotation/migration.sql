-- Phase 2: Add Request For Quotation (RFQ) entity with multi-PR batching and re-solicit support
-- - Splits outgoing RFQ (request) from incoming SupplierQuote (response)
-- - Adds `round` to SupplierQuote so re-solicits don't collide on unique constraint
-- - Join tables: rfq_purchase_requisitions (many PR per RFQ), rfq_supplier_recipients (per-supplier send/response tracking)

-- ── 1. Add new columns to supplier_quotes (requestForQuotationId, round) ─────
ALTER TABLE `supplier_quotes`
  ADD COLUMN `requestForQuotationId` VARCHAR(191) NULL,
  ADD COLUMN `round` INT NOT NULL DEFAULT 1;

-- Replace old unique constraint (tenantId, purchaseRequisitionId, supplierId)
-- with one that includes round (so round 2 with same supplier is allowed).
ALTER TABLE `supplier_quotes`
  DROP INDEX `supplier_quotes_tenantId_purchaseRequisitionId_supplierId_key`;

ALTER TABLE `supplier_quotes`
  ADD UNIQUE INDEX `supplier_quotes_tenant_pr_supplier_round_key`
    (`tenantId`, `purchaseRequisitionId`, `supplierId`, `round`);

CREATE INDEX `supplier_quotes_requestForQuotationId_idx`
  ON `supplier_quotes`(`requestForQuotationId`);

-- ── 2. Create request_for_quotations table ──────────────────────────────────
CREATE TABLE `request_for_quotations` (
  `id`            VARCHAR(191) NOT NULL,
  `tenantId`      VARCHAR(191) NOT NULL,
  `propertyId`    VARCHAR(191) NOT NULL,
  `rfqNumber`     VARCHAR(191) NOT NULL,
  `status`        ENUM('DRAFT','SENT','PARTIAL_RESPONSE','FULLY_RESPONDED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `round`         INT NOT NULL DEFAULT 1,
  `parentRfqId`   VARCHAR(191) NULL,
  `subject`       VARCHAR(191) NULL,
  `coverLetter`   TEXT NULL,
  `customTerms`   TEXT NULL,
  `templateId`    VARCHAR(191) NULL,
  `issuedAt`      DATETIME(3) NULL,
  `deadline`      DATETIME(3) NULL,
  `createdBy`     VARCHAR(191) NOT NULL,
  `cancelledBy`   VARCHAR(191) NULL,
  `cancelledAt`   DATETIME(3) NULL,
  `cancelReason`  TEXT NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3) NOT NULL,

  UNIQUE INDEX `request_for_quotations_tenantId_rfqNumber_key` (`tenantId`, `rfqNumber`),
  INDEX `request_for_quotations_tenantId_idx`    (`tenantId`),
  INDEX `request_for_quotations_propertyId_idx`  (`propertyId`),
  INDEX `request_for_quotations_status_idx`      (`status`),
  INDEX `request_for_quotations_createdBy_idx`   (`createdBy`),
  INDEX `request_for_quotations_parentRfqId_idx` (`parentRfqId`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 3. Create rfq_purchase_requisitions (RFQ ↔ PR join table) ───────────────
CREATE TABLE `rfq_purchase_requisitions` (
  `id`                    VARCHAR(191) NOT NULL,
  `requestForQuotationId` VARCHAR(191) NOT NULL,
  `purchaseRequisitionId` VARCHAR(191) NOT NULL,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `rfq_pr_rfqId_prId_key`
    (`requestForQuotationId`, `purchaseRequisitionId`),
  INDEX `rfq_purchase_requisitions_requestForQuotationId_idx` (`requestForQuotationId`),
  INDEX `rfq_purchase_requisitions_purchaseRequisitionId_idx`  (`purchaseRequisitionId`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 4. Create rfq_supplier_recipients (per-supplier sending + response state) ─
CREATE TABLE `rfq_supplier_recipients` (
  `id`                    VARCHAR(191) NOT NULL,
  `requestForQuotationId` VARCHAR(191) NOT NULL,
  `supplierId`            VARCHAR(191) NOT NULL,
  `sentAt`                DATETIME(3) NULL,
  `remindedAt`            DATETIME(3) NULL,
  `remindCount`           INT NOT NULL DEFAULT 0,
  `respondedAt`           DATETIME(3) NULL,
  `declinedAt`            DATETIME(3) NULL,
  `declineReason`         TEXT NULL,
  `notes`                 TEXT NULL,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3) NOT NULL,

  UNIQUE INDEX `rfq_supplier_recipients_requestForQuotationId_supplierId_key`
    (`requestForQuotationId`, `supplierId`),
  INDEX `rfq_supplier_recipients_requestForQuotationId_idx` (`requestForQuotationId`),
  INDEX `rfq_supplier_recipients_supplierId_idx`            (`supplierId`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ── 5. Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE `supplier_quotes`
  ADD CONSTRAINT `supplier_quotes_requestForQuotationId_fkey`
    FOREIGN KEY (`requestForQuotationId`) REFERENCES `request_for_quotations`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `request_for_quotations`
  ADD CONSTRAINT `request_for_quotations_parentRfqId_fkey`
    FOREIGN KEY (`parentRfqId`) REFERENCES `request_for_quotations`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `rfq_purchase_requisitions`
  ADD CONSTRAINT `rfq_purchase_requisitions_requestForQuotationId_fkey`
    FOREIGN KEY (`requestForQuotationId`) REFERENCES `request_for_quotations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rfq_purchase_requisitions_purchaseRequisitionId_fkey`
    FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rfq_supplier_recipients`
  ADD CONSTRAINT `rfq_supplier_recipients_requestForQuotationId_fkey`
    FOREIGN KEY (`requestForQuotationId`) REFERENCES `request_for_quotations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rfq_supplier_recipients_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
