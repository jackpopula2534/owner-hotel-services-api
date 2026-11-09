-- Add per-zone code (prefix for pitch codes, e.g. "A")
ALTER TABLE `camp_zones`
  ADD COLUMN `code` VARCHAR(10) NULL AFTER `name`;
