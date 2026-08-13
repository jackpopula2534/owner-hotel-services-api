-- Per-outlet charge policy. Defaults match the values that were hardcoded in
-- OrderService.create() (7% VAT, 10% service), so existing outlets keep
-- behaving exactly as they did before this migration.
ALTER TABLE `restaurants`
    ADD COLUMN `vatEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 7.00,
    ADD COLUMN `serviceChargeEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `serviceRate` DECIMAL(5, 2) NOT NULL DEFAULT 10.00;
