-- Subscription coupon catalog + per-redemption audit log.
-- Note: a separate `coupons` table (in the loyalty/booking domain) already
-- exists. This module manages discounts applied to SaaS subscription
-- invoices, so we name our tables `subscription_coupons` to avoid the
-- collision.

CREATE TABLE `subscription_coupons` (
  `id` VARCHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `discount_type` ENUM('percent', 'fixed') NOT NULL,
  `discount_value` DECIMAL(10,2) NOT NULL,
  `applies_to` ENUM('any_plan', 'specific_plans', 'first_invoice_only') NOT NULL DEFAULT 'any_plan',
  `applicable_plan_ids` JSON NULL,
  `max_redemptions` INT NULL,
  `redemptions_count` INT NOT NULL DEFAULT 0,
  `max_redemptions_per_tenant` INT NOT NULL DEFAULT 1,
  `valid_from` DATETIME(6) NOT NULL,
  `valid_until` DATETIME(6) NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `metadata` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_sub_coupons_code` (`code`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscription_coupon_redemptions` (
  `id` VARCHAR(36) NOT NULL,
  `coupon_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `invoice_id` VARCHAR(36) NULL,
  `subscription_id` VARCHAR(36) NULL,
  `discount_amount` DECIMAL(10,2) NOT NULL,
  `original_amount` DECIMAL(10,2) NOT NULL,
  `redeemed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_sub_coupon_redemptions_coupon` (`coupon_id`),
  INDEX `IDX_sub_coupon_redemptions_tenant` (`tenant_id`),
  INDEX `IDX_sub_coupon_redemptions_invoice` (`invoice_id`),
  CONSTRAINT `FK_sub_coupon_redemptions_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `subscription_coupons`(`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_sub_coupon_redemptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
