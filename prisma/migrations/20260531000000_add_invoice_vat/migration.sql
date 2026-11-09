-- LEGAL-02: Thai tax-invoice (ใบกำกับภาษี) VAT breakdown on SaaS invoices.
-- `amount` stays as the gross, VAT-inclusive total (backward compatible).
-- subtotal   = pre-VAT base amount
-- vat_rate   = applied VAT rate as a percentage (e.g. 7.00)
-- vat_amount = subtotal * vat_rate / 100
-- All nullable so existing rows remain valid; new invoices populate them.
ALTER TABLE `invoices`
  ADD COLUMN `subtotal` DECIMAL(10, 2) NULL,
  ADD COLUMN `vat_rate` DECIMAL(5, 2) NULL,
  ADD COLUMN `vat_amount` DECIMAL(10, 2) NULL;
