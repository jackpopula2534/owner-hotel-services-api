-- Add per-zone pricing mode, electricity fee config, and rules/restrictions
-- (columns existed in schema.prisma but had no migration -> caused DB drift)
ALTER TABLE `camp_zones`
  ADD COLUMN `pricingMode` VARCHAR(20) NOT NULL DEFAULT 'per_night',
  ADD COLUMN `hasElectricity` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `electricityFee` DECIMAL(10, 2) NULL,
  ADD COLUMN `restrictions` JSON NULL;
