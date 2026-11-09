-- Per-tenant branding (enterprise tier).
--
-- One row per tenant. domain_status tracks the CNAME/DNS verification flow:
--   pending  → admin asked to add a CNAME record
--   verified → DNS resolves to our load balancer
--   failed   → DNS check returned wrong answer
--
-- email_sender_address must be on a verified domain (DKIM/SPF) before
-- emails will use it.

CREATE TABLE `tenant_brandings` (
  `id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `logo_url` VARCHAR(500) NULL,
  `primary_color` VARCHAR(20) NULL,
  `accent_color` VARCHAR(20) NULL,
  `email_sender_name` VARCHAR(120) NULL,
  `email_sender_address` VARCHAR(255) NULL,
  `custom_domain` VARCHAR(255) NULL,
  `domain_status` ENUM('not_configured', 'pending', 'verified', 'failed') NOT NULL DEFAULT 'not_configured',
  `domain_verification_token` VARCHAR(120) NULL,
  `last_verified_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_tenant_brandings_tenant` (`tenant_id`),
  UNIQUE INDEX `IDX_tenant_brandings_domain` (`custom_domain`),
  CONSTRAINT `FK_tenant_brandings_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
