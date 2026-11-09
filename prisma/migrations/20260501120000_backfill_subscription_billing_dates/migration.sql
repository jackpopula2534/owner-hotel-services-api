-- Backfill next_billing_date and billing_anchor_date for existing subscriptions.
--
-- Subscriptions created before the create-subscription endpoint started
-- populating these fields stored NULL, which caused the admin Billing tab
-- to render "บิลถัดไป: N/A".
--
-- For each NULL row we copy the existing period boundary across.
-- This is idempotent and safe to re-run because of the IS NULL guards.

UPDATE `subscriptions`
SET `next_billing_date` = `end_date`
WHERE `next_billing_date` IS NULL
  AND `end_date` IS NOT NULL;

UPDATE `subscriptions`
SET `billing_anchor_date` = `start_date`
WHERE `billing_anchor_date` IS NULL
  AND `start_date` IS NOT NULL;
