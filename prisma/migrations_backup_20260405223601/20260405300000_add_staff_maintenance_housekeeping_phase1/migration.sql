-- Migration: Phase 1 - Staff, MaintenanceTask, BookingAddOn tables
--             + new columns on HousekeepingTask, Booking, Property
-- Run with: npx prisma migrate deploy

SET @db = DATABASE();

-- ─── 1. Properties: Time-settings columns ────────────────────────────────────
SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'standardCheckInTime'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `standardCheckInTime` VARCHAR(5) NOT NULL DEFAULT ''14:00'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'standardCheckOutTime'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `standardCheckOutTime` VARCHAR(5) NOT NULL DEFAULT ''12:00'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'cleaningBufferMinutes'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `cleaningBufferMinutes` INT NOT NULL DEFAULT 60'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'earlyCheckInEnabled'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `earlyCheckInEnabled` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'lateCheckOutEnabled'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `lateCheckOutEnabled` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'earlyCheckInFeeType'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `earlyCheckInFeeType` VARCHAR(191) NULL DEFAULT ''fixed'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'earlyCheckInFeeAmount'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `earlyCheckInFeeAmount` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'lateCheckOutFeeType'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `lateCheckOutFeeType` VARCHAR(191) NULL DEFAULT ''fixed'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'lateCheckOutFeeAmount'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `lateCheckOutFeeAmount` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'properties' AND COLUMN_NAME = 'timezone'
  ),
  'SELECT 1',
  'ALTER TABLE `properties` ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT ''Asia/Bangkok'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 2. Bookings: Time-aware + early/late checkout columns ───────────────────
SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'scheduledCheckIn'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `scheduledCheckIn` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'scheduledCheckOut'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `scheduledCheckOut` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'requestedEarlyCheckIn'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `requestedEarlyCheckIn` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'approvedEarlyCheckIn'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `approvedEarlyCheckIn` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'earlyCheckInFee'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `earlyCheckInFee` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'requestedLateCheckOut'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `requestedLateCheckOut` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'approvedLateCheckOut'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `approvedLateCheckOut` TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'lateCheckOutFee'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `lateCheckOutFee` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'bookings_scheduledCheckIn_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `bookings_scheduledCheckIn_idx` ON `bookings`(`scheduledCheckIn`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND INDEX_NAME = 'bookings_scheduledCheckOut_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `bookings_scheduledCheckOut_idx` ON `bookings`(`scheduledCheckOut`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 3. Staff table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `staff` (
    `id`               VARCHAR(191) NOT NULL,
    `tenantId`         VARCHAR(191) NOT NULL,
    `firstName`        VARCHAR(191) NOT NULL,
    `lastName`         VARCHAR(191) NOT NULL,
    `email`            VARCHAR(191) NOT NULL,
    `phone`            VARCHAR(191) NULL,
    `role`             VARCHAR(191) NOT NULL,
    `department`       VARCHAR(191) NULL,
    `employeeCode`     VARCHAR(191) NULL,
    `status`           VARCHAR(191) NOT NULL DEFAULT 'active',
    `shiftType`        VARCHAR(191) NULL,
    `maxTasksPerShift` INT          NULL DEFAULT 8,
    `specializations`  TEXT         NULL,
    `rating`           DECIMAL(3, 2) NULL,
    `efficiency`       INT          NULL DEFAULT 100,
    `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`        DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `staff_tenantId_idx` (`tenantId`),
    INDEX `staff_status_idx` (`status`),
    INDEX `staff_department_idx` (`department`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 4. MaintenanceTask table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `maintenance_tasks` (
    `id`                VARCHAR(191) NOT NULL,
    `tenantId`          VARCHAR(191) NOT NULL,
    `propertyId`        VARCHAR(191) NOT NULL,
    `roomId`            VARCHAR(191) NULL,
    `title`             VARCHAR(191) NOT NULL,
    `description`       TEXT         NULL,
    `category`          VARCHAR(191) NOT NULL,
    `priority`          VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status`            VARCHAR(191) NOT NULL DEFAULT 'pending',
    `assignedToId`      VARCHAR(191) NULL,
    `requestedDate`     DATETIME(3)  NULL,
    `scheduledDate`     DATETIME(3)  NULL,
    `estimatedDuration` INT          NULL,
    `startedAt`         DATETIME(3)  NULL,
    `completedAt`       DATETIME(3)  NULL,
    `actualDuration`    INT          NULL,
    `estimatedCost`     DECIMAL(10, 2) NULL,
    `actualCost`        DECIMAL(10, 2) NULL,
    `partsUsed`         TEXT         NULL,
    `inspectedById`     VARCHAR(191) NULL,
    `inspectedAt`       DATETIME(3)  NULL,
    `rating`            INT          NULL,
    `inspectionNotes`   TEXT         NULL,
    `notes`             TEXT         NULL,
    `attachments`       TEXT         NULL,
    `createdAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`         DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `maintenance_tasks_tenantId_idx` (`tenantId`),
    INDEX `maintenance_tasks_propertyId_idx` (`propertyId`),
    INDEX `maintenance_tasks_roomId_idx` (`roomId`),
    INDEX `maintenance_tasks_status_idx` (`status`),
    INDEX `maintenance_tasks_category_idx` (`category`),
    INDEX `maintenance_tasks_assignedToId_idx` (`assignedToId`),

    CONSTRAINT `maintenance_tasks_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 5. HousekeepingTask: create base table if missing ───────────────────────
CREATE TABLE IF NOT EXISTS `housekeeping_tasks` (
    `id`                   VARCHAR(191) NOT NULL,
    `tenantId`             VARCHAR(191) NOT NULL,
    `roomId`               VARCHAR(191) NOT NULL,
    `bookingId`            VARCHAR(191) NULL,
    `type`                 VARCHAR(191) NOT NULL DEFAULT 'daily',
    `priority`             VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status`               VARCHAR(191) NOT NULL DEFAULT 'pending',
    `scheduledFor`         DATETIME(3)  NULL,
    `estimatedDuration`    INT          NOT NULL DEFAULT 30,
    `actualStartTime`      DATETIME(3)  NULL,
    `actualEndTime`        DATETIME(3)  NULL,
    `actualDuration`       INT          NULL,
    `startTime`            DATETIME(3)  NULL,
    `endTime`              DATETIME(3)  NULL,
    `roomReadyAt`          DATETIME(3)  NULL,
    `assignedToId`         VARCHAR(191) NULL,
    `assignedToName`       VARCHAR(191) NULL,
    `completionPercentage` INT          NULL,
    `inspectedById`        VARCHAR(191) NULL,
    `inspectedByName`      VARCHAR(191) NULL,
    `inspectedAt`          DATETIME(3)  NULL,
    `rating`               INT          NULL,
    `inspectionNotes`      TEXT         NULL,
    `notes`                TEXT         NULL,
    `createdAt`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`            DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `housekeeping_tasks_roomId_idx` (`roomId`),
    INDEX `housekeeping_tasks_bookingId_idx` (`bookingId`),
    INDEX `housekeeping_tasks_tenantId_idx` (`tenantId`),
    INDEX `housekeeping_tasks_status_idx` (`status`),
    INDEX `housekeeping_tasks_type_idx` (`type`),
    INDEX `housekeeping_tasks_assignedToId_idx` (`assignedToId`),
    INDEX `housekeeping_tasks_scheduledFor_idx` (`scheduledFor`),
    CONSTRAINT `housekeeping_tasks_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `housekeeping_tasks_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `housekeeping_tasks_assignedToId_staff_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `housekeeping_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 6. HousekeepingTask: backfill missing columns/constraints ───────────────
SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'bookingId'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `bookingId` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'scheduledFor'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `scheduledFor` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'roomReadyAt'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `roomReadyAt` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'actualStartTime'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `actualStartTime` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'actualEndTime'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `actualEndTime` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'actualDuration'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `actualDuration` INT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'inspectedById'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `inspectedById` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'assignedToId'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `assignedToId` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'assignedToName'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `assignedToName` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'inspectedByName'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `inspectedByName` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'completionPercentage'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `completionPercentage` INT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'rating'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `rating` INT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'inspectionNotes'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `inspectionNotes` TEXT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'notes'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `notes` TEXT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'startTime'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `startTime` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND COLUMN_NAME = 'endTime'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD COLUMN `endTime` DATETIME(3) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND CONSTRAINT_NAME = 'housekeeping_tasks_bookingId_fkey'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND CONSTRAINT_NAME = 'housekeeping_tasks_inspectedById_fkey'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND CONSTRAINT_NAME = 'housekeeping_tasks_assignedToId_staff_fkey'
  ),
  'SELECT 1',
  'ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_assignedToId_staff_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND INDEX_NAME = 'housekeeping_tasks_bookingId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `housekeeping_tasks_bookingId_idx` ON `housekeeping_tasks`(`bookingId`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND INDEX_NAME = 'housekeeping_tasks_scheduledFor_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `housekeeping_tasks_scheduledFor_idx` ON `housekeeping_tasks`(`scheduledFor`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'housekeeping_tasks' AND INDEX_NAME = 'housekeeping_tasks_assignedToId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `housekeeping_tasks_assignedToId_idx` ON `housekeeping_tasks`(`assignedToId`)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 7. BookingAddOn table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `booking_add_ons` (
    `id`          VARCHAR(191) NOT NULL,
    `bookingId`   VARCHAR(191) NOT NULL,
    `tenantId`    VARCHAR(191) NOT NULL,
    `type`        VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity`    INT NOT NULL DEFAULT 1,
    `unitPrice`   DECIMAL(10, 2) NOT NULL,
    `amount`      DECIMAL(10, 2) NOT NULL,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `booking_add_ons_bookingId_idx` (`bookingId`),
    INDEX `booking_add_ons_tenantId_idx` (`tenantId`),
    CONSTRAINT `booking_add_ons_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
