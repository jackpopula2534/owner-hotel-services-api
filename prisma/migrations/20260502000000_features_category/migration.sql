-- Add category, icon, display_order to features table
-- so that Features admin UI can group them into CORE/PMS/RESTAURANT/HR/etc.
-- Without this column, the UI was showing N/A for every row.

ALTER TABLE `features`
  ADD COLUMN `category`      VARCHAR(80) NULL AFTER `type`,
  ADD COLUMN `icon`          VARCHAR(80) NULL AFTER `category`,
  ADD COLUMN `display_order` INT         NOT NULL DEFAULT 0 AFTER `icon`;

CREATE INDEX `IDX_features_category`  ON `features` (`category`);
CREATE INDEX `IDX_features_is_active` ON `features` (`is_active`);
