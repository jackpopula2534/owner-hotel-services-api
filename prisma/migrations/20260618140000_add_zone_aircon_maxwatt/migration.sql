-- Add per-zone electrical rules: mobile aircon allowance + max wattage limit
ALTER TABLE `camp_zones`
  ADD COLUMN `allowAircon` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `maxWatt` INTEGER NULL;
