-- Task 2 (pricing restructure): link a feature to its parent module.
--
-- `module_code` references `add_ons.code` (the 7 sellable modules). It is a
-- plain nullable VARCHAR (not a hard FK) to match how module codes are already
-- referenced as strings elsewhere (@RequireAddon, CHILD_ADDON_GRANTS) and to
-- tolerate a module being deactivated without cascading to its features.
--
-- NULL = standalone/general feature sold on its own (ขายแยก ไม่มี module แม่).
-- When set, /features/public + the pricing tree nest this feature under the
-- matching module (module ▸ feature).

ALTER TABLE `features`
  ADD COLUMN `module_code` VARCHAR(80) NULL AFTER `category`;

CREATE INDEX `IDX_features_module_code` ON `features` (`module_code`);
