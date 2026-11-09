-- Split the Campground product line off the hotel packages.
--
-- CAMP_MODULE was seeded as system='BOTH' and bundled into the hotel FREE
-- (15-day trial) and L (Business) plans via plan_addons. That made every hotel
-- tenant on those plans an entitled campground user: the "ลานกางเต็นท์" sidebar
-- section, the Campground sub-system tile, and a "Campground Module — ใช้งานได้"
-- card on their subscription page. Campground is a separate product line sold
-- through its own CAMP plans, so it must not reach a hotel plan at all.

-- 1. Tag the module as campground-only. `add_ons.system` defaults to 'BOTH', and
--    20260630120000 added the column without backfilling this row, so existing
--    databases still carry 'BOTH' here and keep serving it from
--    GET /addons/public?system=HOTEL.
UPDATE `add_ons` SET `system` = 'CAMP' WHERE `code` = 'CAMP_MODULE';

-- 2. Drop every plan_addons row that bundles a module into a plan from a
--    different product line. Written as a general invariant rather than a
--    CAMP_MODULE-specific DELETE so a hotel module wrongly attached to a camp
--    plan is cleaned up by the same statement. Modules tagged 'BOTH'
--    (Restaurant, HR, Inventory, …) are compatible with both lines and stay.
DELETE `pa` FROM `plan_addons` `pa`
INNER JOIN `add_ons` `a` ON `a`.`id` = `pa`.`addon_id`
INNER JOIN `plans` `p` ON `p`.`id` = `pa`.`plan_id`
WHERE `a`.`system` <> 'BOTH'
  AND `a`.`system` <> `p`.`system`;
