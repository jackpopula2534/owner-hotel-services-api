-- Revoke cross-product-line entitlements granted before the Hotel / Campground
-- split was enforced in code.
--
-- 20260713120000 stopped the bleeding at the PLAN level (retagged CAMP_MODULE as
-- system='CAMP', unbundled it from hotel plans). What it did not touch is
-- entitlement granted directly to a SUBSCRIPTION — `subscription_features` rows
-- and approved trial requests — because those represent access a customer may
-- have paid for. This migration closes that, now that the business has decided
-- hotel tenants do not keep the campground module.
--
-- Two deliberate choices:
--
--   * Nothing is deleted from `subscription_features`. Rows are switched off
--     (`is_active = 0`), which is exactly what revokes access — AddonGuard goes
--     through getActiveAddons(), which filters on `is_active = 1`. The row
--     survives, so billing history and any refund/proration finance decides on
--     still have their source data, and the change is reversible.
--   * Every revocation is written to `subscription_feature_logs` BEFORE it takes
--     effect, with the old price. That is the app's own feature-history table, so
--     this shows up wherever subscription history is rendered — and it doubles as
--     the rollback set (see ROLLBACK at the bottom). No throwaway backup table,
--     which would sit outside schema.prisma and read as drift to `migrate dev`.
--
-- The rules are written as general invariants ("a subscription must not carry a
-- module from a line other than its plan's"), not as CAMP_MODULE-specific
-- statements, so the reverse case — a hotel module on a camp subscription — is
-- cleaned up by the same statements.
--
-- Module lookup: `features` carries no product line of its own, so a feature maps
-- to the module catalog by its own code (module-type features share the add-on
-- code) or by its parent `module_code`. A sub-feature of CAMP_MODULE is therefore
-- revoked along with the module — otherwise the module returns one child feature
-- at a time.
--
-- DRY RUN — run this first to see exactly who is affected and what it is worth:
--
--   SELECT s.tenant_id, t.name AS tenant, p.system AS plan_line, p.name AS plan,
--          f.code AS feature, COALESCE(a.system,'BOTH') AS module_line, sf.price
--   FROM subscription_features sf
--   INNER JOIN features f      ON f.id = sf.feature_id
--   INNER JOIN subscriptions s ON s.id = sf.subscription_id
--   INNER JOIN tenants t       ON t.id = s.tenant_id
--   INNER JOIN plans p         ON p.id = s.plan_id
--   INNER JOIN add_ons a       ON a.code = COALESCE(f.module_code, f.code)
--   WHERE sf.is_active = 1
--     AND COALESCE(a.system,'BOTH') <> 'BOTH'
--     AND COALESCE(a.system,'BOTH') <> COALESCE(p.system,'HOTEL');

-- ---------------------------------------------------------------------------
-- 1. Audit trail + rollback set. Written first, while the rows are still active.
--    `created_by` is NULL because no admin performed this; the reason says so.
-- ---------------------------------------------------------------------------
INSERT INTO `subscription_feature_logs`
  (`id`, `action`, `old_price`, `new_price`, `reason`, `created_at`,
   `subscription_feature_id`, `subscription_id`, `feature_id`, `feature_name`, `created_by`)
SELECT
  UUID(),
  'removed',
  `sf`.`price`,
  NULL,
  CONCAT(
    'Revoked by product-line separation (migration 20260713140000): module "',
    COALESCE(`f`.`module_code`, `f`.`code`),
    '" belongs to the ', COALESCE(`a`.`system`, 'BOTH'),
    ' line but this subscription is on a ', COALESCE(`p`.`system`, 'HOTEL'), ' plan.'
  ),
  NOW(6),
  `sf`.`id`,
  `sf`.`subscription_id`,
  `sf`.`feature_id`,
  `f`.`name`,
  NULL
FROM `subscription_features` `sf`
INNER JOIN `features`      `f` ON `f`.`id` = `sf`.`feature_id`
INNER JOIN `subscriptions` `s` ON `s`.`id` = `sf`.`subscription_id`
INNER JOIN `plans`         `p` ON `p`.`id` = `s`.`plan_id`
INNER JOIN `add_ons`       `a` ON `a`.`code` = COALESCE(`f`.`module_code`, `f`.`code`)
WHERE `sf`.`is_active` = 1
  AND COALESCE(`a`.`system`, 'BOTH') <> 'BOTH'
  AND COALESCE(`a`.`system`, 'BOTH') <> COALESCE(`p`.`system`, 'HOTEL');

-- ---------------------------------------------------------------------------
-- 2. Revoke. Same predicate as the log insert above, so exactly the rows just
--    logged are the rows switched off.
-- ---------------------------------------------------------------------------
UPDATE `subscription_features` `sf`
INNER JOIN `features`      `f` ON `f`.`id` = `sf`.`feature_id`
INNER JOIN `subscriptions` `s` ON `s`.`id` = `sf`.`subscription_id`
INNER JOIN `plans`         `p` ON `p`.`id` = `s`.`plan_id`
INNER JOIN `add_ons`       `a` ON `a`.`code` = COALESCE(`f`.`module_code`, `f`.`code`)
SET `sf`.`is_active` = 0,
    `sf`.`updated_at` = NOW(6)
WHERE `sf`.`is_active` = 1
  AND COALESCE(`a`.`system`, 'BOTH') <> 'BOTH'
  AND COALESCE(`a`.`system`, 'BOTH') <> COALESCE(`p`.`system`, 'HOTEL');

-- ---------------------------------------------------------------------------
-- 3. Plan-level features from the wrong line. Same invariant as the plan_addons
--    DELETE in 20260713120000, applied to the other table that feeds
--    getActiveAddons(). These are Admin configuration, not purchased
--    entitlement, so they go outright — Admin can re-add them to a plan of the
--    correct line.
-- ---------------------------------------------------------------------------
DELETE `pf` FROM `plan_features` `pf`
INNER JOIN `features` `f` ON `f`.`id` = `pf`.`feature_id`
INNER JOIN `plans`    `p` ON `p`.`id` = `pf`.`plan_id`
INNER JOIN `add_ons`  `a` ON `a`.`code` = COALESCE(`f`.`module_code`, `f`.`code`)
WHERE COALESCE(`a`.`system`, 'BOTH') <> 'BOTH'
  AND COALESCE(`a`.`system`, 'BOTH') <> COALESCE(`p`.`system`, 'HOTEL');

-- ---------------------------------------------------------------------------
-- 4. Free trials. An approved, unexpired `addon_trial_requests` row is now a live
--    entitlement in its own right (getActiveAddons reads it directly), so
--    revoking the paid rows above without this would leave the campground module
--    switched on for any hotel tenant who happened to be mid-trial.
--
--    A tenant's line comes from the plan behind their newest 'active' or 'trial'
--    subscription — the same rule AddonService.getTenantSystem() applies, down to
--    treating a tenant with no such subscription as HOTEL.
--
--    Marked 'expired', not 'rejected': the trial was legitimately approved, it is
--    simply over. That is also the status the hourly AddonTrialExpiryService
--    uses, and it leaves the tenant free to request the module again if they ever
--    move to a camp plan.
-- ---------------------------------------------------------------------------
UPDATE `addon_trial_requests` `tr`
INNER JOIN `add_ons` `a` ON `a`.`code` = `tr`.`addon_code`
SET `tr`.`status` = 'expired',
    `tr`.`expires_at` = NOW(6),
    `tr`.`admin_note` = CONCAT(
      COALESCE(CONCAT(`tr`.`admin_note`, ' | '), ''),
      'ยุติการทดลองใช้โดย migration 20260713140000: โมดูลนี้เป็นของสายธุรกิจ ',
      COALESCE(`a`.`system`, 'BOTH'), ' แต่ผู้เช่าอยู่คนละสาย'
    ),
    `tr`.`updated_at` = NOW(6)
WHERE `tr`.`status` = 'approved'
  AND COALESCE(`a`.`system`, 'BOTH') <> 'BOTH'
  AND COALESCE(`a`.`system`, 'BOTH') <> COALESCE((
    SELECT COALESCE(`p`.`system`, 'HOTEL')
    FROM `subscriptions` `s`
    INNER JOIN `plans` `p` ON `p`.`id` = `s`.`plan_id`
    WHERE `s`.`tenant_id` = `tr`.`tenant_id`
      AND `s`.`status` IN ('active', 'trial')
    ORDER BY `s`.`created_at` DESC
    LIMIT 1
  ), 'HOTEL');

-- ---------------------------------------------------------------------------
-- AFTER RUNNING
--
-- Redis caches each tenant's add-on list for 5 minutes, so a revoked tenant may
-- still see the module until the TTL lapses. It is self-healing; to cut it short,
-- restart the API (the cache is not persisted). Nothing needs flushing by hand.
--
-- ROLLBACK — restores exactly what step 2 switched off, and nothing else:
--
--   UPDATE `subscription_features` `sf`
--   INNER JOIN `subscription_feature_logs` `l` ON `l`.`subscription_feature_id` = `sf`.`id`
--   SET `sf`.`is_active` = 1, `sf`.`updated_at` = NOW(6)
--   WHERE `l`.`reason` LIKE 'Revoked by product-line separation (migration 20260713140000)%';
--
-- Steps 3 and 4 are not covered by that: plan features are Admin config that can
-- be re-added from the Plans page, and an expired trial can simply be requested
-- again. Only the paid rows get the safety net.
-- ---------------------------------------------------------------------------
