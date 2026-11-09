-- Which floor-plan furniture a table is drawn as (e.g. 'rect-table-6').
--
-- Before this the plan inferred the furniture from `shape` + `capacity`, which
-- is lossy: SQUARE + 4 seats is both a square 4-top and a booth, so a table
-- added from the table list could be drawn as something else on the plan.
--
-- Nullable on purpose — existing rows keep falling back to the old inference.
ALTER TABLE `restaurant_tables` ADD COLUMN `furnitureType` VARCHAR(50) NULL;
