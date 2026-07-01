-- Add product-line discriminator to plans + add_ons (HOTEL | CAMP | BOTH)
-- Supports the 2-system sales split (โรงแรม / ลานกางเต็นท์).

ALTER TABLE `plans`
  ADD COLUMN `system` VARCHAR(20) NOT NULL DEFAULT 'HOTEL' AFTER `code`;

ALTER TABLE `add_ons`
  ADD COLUMN `system` VARCHAR(20) NOT NULL DEFAULT 'BOTH' AFTER `code`;

-- Retire add-ons that are no longer sold standalone:
--   • placeholders (no real feature): EXTRA_ANALYTICS, AUTOMATION_MODULE, CUSTOM_BRANDING
--   • OTA not ready: OTA_INTEGRATION, CHANNEL_MANAGER
--   • folded into a parent module: POS_MODULE→Restaurant, LOYALTY_MODULE→CRM,
--     COST_ACCOUNTING_MODULE→Accounting (entitlement granted via CHILD_ADDON_GRANTS)
UPDATE `add_ons`
SET `is_active` = 0
WHERE `code` IN (
  'OTA_INTEGRATION',
  'CHANNEL_MANAGER',
  'EXTRA_ANALYTICS',
  'AUTOMATION_MODULE',
  'CUSTOM_BRANDING',
  'POS_MODULE',
  'LOYALTY_MODULE',
  'COST_ACCOUNTING_MODULE'
);
