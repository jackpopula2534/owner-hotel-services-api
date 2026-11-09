-- Tenant-scoped API keys for third-party integrations.
--
-- We store only the SHA-256 hash of the secret; the plain key is shown
-- to the user once at creation time.

CREATE TABLE `api_keys` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `key_prefix` VARCHAR(16) NOT NULL,
  `key_hash` VARCHAR(128) NOT NULL,
  `scopes` JSON NOT NULL,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `last_used_at` DATETIME(6) NULL,
  `expires_at` DATETIME(6) NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `revoked_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_api_keys_hash` (`key_hash`),
  INDEX `IDX_api_keys_tenant` (`tenant_id`),
  INDEX `IDX_api_keys_prefix` (`key_prefix`),
  CONSTRAINT `FK_api_keys_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
