-- Add Sub-System flag + card metadata to add_ons catalog.
-- Run via: npx prisma migrate dev --name add_ons_sub_system
-- or apply this SQL directly, then `npx prisma generate`.

ALTER TABLE `add_ons`
  ADD COLUMN `is_sub_system` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `sub_system_meta` TEXT NULL;

CREATE INDEX `IDX_add_ons_is_sub_system` ON `add_ons` (`is_sub_system`);
