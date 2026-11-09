-- Status page entities.
--
-- service_components:
--   The "things" customers care about (API, Web app, Database, etc.).
--   Each row has a current operational status.
--
-- incidents:
--   Customer-visible incident timeline. Multiple updates are appended as
--   incident_updates rows so we keep a full history.

CREATE TABLE `service_components` (
  `id` VARCHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance') NOT NULL DEFAULT 'operational',
  `display_order` INT NOT NULL DEFAULT 0,
  `is_visible` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `IDX_service_components_code` (`code`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `incidents` (
  `id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `severity` ENUM('minor', 'major', 'critical') NOT NULL DEFAULT 'minor',
  `status` ENUM('investigating', 'identified', 'monitoring', 'resolved') NOT NULL DEFAULT 'investigating',
  `affected_components` JSON NULL,
  `started_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resolved_at` DATETIME(6) NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_incidents_status` (`status`),
  INDEX `IDX_incidents_started_at` (`started_at`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `incident_updates` (
  `id` VARCHAR(36) NOT NULL,
  `incident_id` VARCHAR(36) NOT NULL,
  `status` ENUM('investigating', 'identified', 'monitoring', 'resolved') NOT NULL,
  `message` TEXT NOT NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  INDEX `IDX_incident_updates_incident` (`incident_id`),
  CONSTRAINT `FK_incident_updates_incident` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `uptime_checks` (
  `id` VARCHAR(36) NOT NULL,
  `component_id` VARCHAR(36) NOT NULL,
  `checked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `status` ENUM('up', 'down') NOT NULL,
  `latency_ms` INT NULL,
  `error_message` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `IDX_uptime_component_time` (`component_id`, `checked_at`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
