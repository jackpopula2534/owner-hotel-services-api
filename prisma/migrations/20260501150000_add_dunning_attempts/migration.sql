-- Dunning attempt log: each row = one collection action
-- (reminder email/LINE/manual call) targeting an overdue invoice.

CREATE TABLE `dunning_attempts` (
  `id` VARCHAR(36) NOT NULL,
  `invoice_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `level` ENUM('reminder', 'first_warning', 'second_warning', 'final_notice') NOT NULL,
  `channel` ENUM('email', 'line', 'sms', 'manual') NOT NULL,
  `status` ENUM('queued', 'sent', 'failed', 'acknowledged') NOT NULL DEFAULT 'queued',
  `recipient` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NULL,
  `error_message` TEXT NULL,
  `metadata` JSON NULL,
  `sent_at` DATETIME(6) NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_dunning_invoice` (`invoice_id`),
  INDEX `IDX_dunning_tenant` (`tenant_id`),
  INDEX `IDX_dunning_level_status` (`level`, `status`),
  CONSTRAINT `FK_dunning_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_dunning_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
