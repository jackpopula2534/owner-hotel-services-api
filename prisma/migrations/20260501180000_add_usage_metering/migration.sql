-- Usage metering tables.
--
-- usage_metric_definitions:
--   Catalog of metrics we track per tenant. Each metric has a unit
--   (count, gb, requests) and an aggregation strategy (sum_per_period
--   for usage we count up over a billing month, or peak_in_period for
--   high-water-mark like "max simultaneous rooms").
--
-- usage_counters:
--   Hot counter — one row per (tenant, metric, period) bucket. Service
--   uses INSERT ... ON DUPLICATE KEY UPDATE for atomic increment so we
--   don't need Redis for correctness.
--
-- usage_overage_charges:
--   Materialized overage rows produced by the monthly billing cron. The
--   tenant sees these as line items on next invoice.

CREATE TABLE `usage_metric_definitions` (
  `id` VARCHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `unit` VARCHAR(40) NOT NULL DEFAULT 'count',
  `aggregation` ENUM('sum_per_period', 'peak_in_period') NOT NULL DEFAULT 'sum_per_period',
  `overage_unit_price` DECIMAL(10,4) NOT NULL DEFAULT 0,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_usage_metric_code` (`code`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `usage_counters` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `metric_code` VARCHAR(80) NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `value` BIGINT NOT NULL DEFAULT 0,
  `peak_value` BIGINT NOT NULL DEFAULT 0,
  `last_event_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_usage_counter_unique` (`tenant_id`, `metric_code`, `period`),
  INDEX `IDX_usage_counter_period` (`period`),
  CONSTRAINT `FK_usage_counter_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `usage_overage_charges` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `metric_code` VARCHAR(80) NOT NULL,
  `period` VARCHAR(7) NOT NULL,
  `usage_amount` BIGINT NOT NULL,
  `included_amount` BIGINT NOT NULL,
  `overage_amount` BIGINT NOT NULL,
  `unit_price` DECIMAL(10,4) NOT NULL,
  `total_charge` DECIMAL(10,2) NOT NULL,
  `invoice_id` VARCHAR(36) NULL,
  `status` ENUM('pending', 'invoiced', 'waived') NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_overage_unique` (`tenant_id`, `metric_code`, `period`),
  INDEX `IDX_overage_status` (`status`),
  CONSTRAINT `FK_overage_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
