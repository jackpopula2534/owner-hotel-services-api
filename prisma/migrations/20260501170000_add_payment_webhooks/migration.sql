-- Inbound webhook log + reconciliation report rows.
--
-- payment_webhook_events:
--   Every webhook from PromptPay/SCB/2C2P/etc lands here. Idempotency
--   key prevents duplicate processing if the gateway retries.
--
-- payment_reconciliation_runs:
--   One row per daily reconciliation pass. mismatches array points at
--   payments that don't agree with the gateway statement.

CREATE TABLE `payment_webhook_events` (
  `id` VARCHAR(36) NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `idempotency_key` VARCHAR(120) NOT NULL,
  `signature` TEXT NULL,
  `signature_verified` TINYINT NOT NULL DEFAULT 0,
  `payload` JSON NOT NULL,
  `status` ENUM('received', 'processed', 'failed', 'duplicate') NOT NULL DEFAULT 'received',
  `error_message` TEXT NULL,
  `payment_id` VARCHAR(36) NULL,
  `received_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `processed_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_webhook_idempotency` (`provider`, `idempotency_key`),
  INDEX `IDX_webhook_status` (`status`),
  INDEX `IDX_webhook_received_at` (`received_at`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_reconciliation_runs` (
  `id` VARCHAR(36) NOT NULL,
  `provider` VARCHAR(50) NOT NULL,
  `period_start` DATETIME(6) NOT NULL,
  `period_end` DATETIME(6) NOT NULL,
  `db_total_count` INT NOT NULL DEFAULT 0,
  `db_total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `gateway_total_count` INT NOT NULL DEFAULT 0,
  `gateway_total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `mismatch_count` INT NOT NULL DEFAULT 0,
  `mismatches` JSON NULL,
  `status` ENUM('clean', 'mismatch', 'failed') NOT NULL DEFAULT 'clean',
  `notes` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_reconciliation_provider_period` (`provider`, `period_start`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
