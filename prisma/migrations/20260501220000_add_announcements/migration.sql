-- Tenant Communication Center.
--
-- announcements:
--   Platform-wide or segmented broadcast messages from admin.
--
-- announcement_reads:
--   Per-tenant ack so we can show "Mark as read" / unread counts.

CREATE TABLE `announcements` (
  `id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `severity` ENUM('info', 'warning', 'critical', 'maintenance') NOT NULL DEFAULT 'info',
  `audience` ENUM('all', 'tenants_by_status', 'specific_tenants') NOT NULL DEFAULT 'all',
  `audience_filter` JSON NULL,
  `cta_label` VARCHAR(120) NULL,
  `cta_url` VARCHAR(500) NULL,
  `published_at` DATETIME(6) NULL,
  `expires_at` DATETIME(6) NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_announcements_published` (`published_at`),
  INDEX `IDX_announcements_expires` (`expires_at`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_reads` (
  `id` VARCHAR(36) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NULL,
  `read_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_announcement_reads_unique` (`announcement_id`, `tenant_id`),
  CONSTRAINT `FK_announcement_reads_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
