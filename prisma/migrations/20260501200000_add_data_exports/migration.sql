-- PDPA / GDPR-style data export + erasure log.

CREATE TABLE `data_export_requests` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `requested_by_user_id` VARCHAR(36) NULL,
  `kind` ENUM('export', 'erasure') NOT NULL DEFAULT 'export',
  `status` ENUM('queued', 'processing', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'queued',
  `download_url` VARCHAR(2048) NULL,
  `download_expires_at` DATETIME(6) NULL,
  `byte_size` BIGINT NULL,
  `error_message` TEXT NULL,
  `requested_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  INDEX `IDX_data_export_tenant` (`tenant_id`),
  INDEX `IDX_data_export_status` (`status`),
  CONSTRAINT `FK_data_export_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
