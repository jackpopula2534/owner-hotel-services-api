-- Phase: Supplier Portal (magic link tokens)
-- Adds supplier_quote_tokens: single-use-ish access tokens sent via email to
-- suppliers so they can fill a quote in the public portal without logging in.
-- Token expiry is pinned to the parent RFQ.deadline. Admins can revoke tokens
-- to force a regeneration / resend.

CREATE TABLE `supplier_quote_tokens` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `supplierQuoteId`       VARCHAR(191) NOT NULL,
  `requestForQuotationId` VARCHAR(191) NOT NULL,
  `supplierId`            VARCHAR(191) NOT NULL,
  `tokenHash`             VARCHAR(191) NOT NULL,
  `expiresAt`             DATETIME(3) NOT NULL,
  `usedAt`                DATETIME(3) NULL,
  `revokedAt`             DATETIME(3) NULL,
  `lastAccessedAt`        DATETIME(3) NULL,
  `accessCount`           INT NOT NULL DEFAULT 0,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `supplier_quote_tokens_tokenHash_key` (`tokenHash`),
  INDEX `supplier_quote_tokens_tenantId_idx`              (`tenantId`),
  INDEX `supplier_quote_tokens_supplierQuoteId_idx`       (`supplierQuoteId`),
  INDEX `supplier_quote_tokens_requestForQuotationId_idx` (`requestForQuotationId`),
  INDEX `supplier_quote_tokens_supplierId_idx`            (`supplierId`),
  INDEX `supplier_quote_tokens_expiresAt_idx`             (`expiresAt`),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supplier_quote_tokens`
  ADD CONSTRAINT `supplier_quote_tokens_supplierQuoteId_fkey`
    FOREIGN KEY (`supplierQuoteId`)
    REFERENCES `supplier_quotes`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `supplier_quote_tokens`
  ADD CONSTRAINT `supplier_quote_tokens_requestForQuotationId_fkey`
    FOREIGN KEY (`requestForQuotationId`)
    REFERENCES `request_for_quotations`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `supplier_quote_tokens`
  ADD CONSTRAINT `supplier_quote_tokens_supplierId_fkey`
    FOREIGN KEY (`supplierId`)
    REFERENCES `suppliers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
