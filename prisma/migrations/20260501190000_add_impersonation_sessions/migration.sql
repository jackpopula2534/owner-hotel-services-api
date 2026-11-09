-- Impersonation session log.
--
-- Each row represents one platform-admin acting on a tenant's behalf.
-- The JWT issued to the admin carries `session_id`; every authenticated
-- request during impersonation is audited against this row so we can
-- prove (after the fact) exactly what was changed and by whom.

CREATE TABLE `impersonation_sessions` (
  `id` VARCHAR(36) NOT NULL,
  `admin_id` VARCHAR(36) NOT NULL,
  `target_tenant_id` VARCHAR(36) NOT NULL,
  `target_user_id` VARCHAR(36) NULL,
  `reason` VARCHAR(255) NULL,
  `scope` ENUM('read_only', 'full') NOT NULL DEFAULT 'read_only',
  `status` ENUM('active', 'ended', 'expired') NOT NULL DEFAULT 'active',
  `started_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `ended_at` DATETIME(6) NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  PRIMARY KEY (`id`),
  INDEX `IDX_impersonation_admin` (`admin_id`),
  INDEX `IDX_impersonation_tenant` (`target_tenant_id`),
  INDEX `IDX_impersonation_status` (`status`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
