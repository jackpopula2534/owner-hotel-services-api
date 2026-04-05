-- Migration: Phase 1 — Staff, MaintenanceTask, BookingAddOn tables
--             + new columns on HousekeepingTask, Booking, Property
-- Run with: npx prisma migrate deploy

-- ─── 1. Properties: Time-settings columns ────────────────────────────────────
ALTER TABLE `properties`
    ADD COLUMN IF NOT EXISTS `standardCheckInTime`   VARCHAR(5)      NOT NULL DEFAULT '14:00',
    ADD COLUMN IF NOT EXISTS `standardCheckOutTime`  VARCHAR(5)      NOT NULL DEFAULT '12:00',
    ADD COLUMN IF NOT EXISTS `cleaningBufferMinutes` INT             NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS `earlyCheckInEnabled`   TINYINT(1)     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `lateCheckOutEnabled`   TINYINT(1)     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `earlyCheckInFeeType`   VARCHAR(191)    NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS `earlyCheckInFeeAmount` DECIMAL(10, 2)  NULL,
    ADD COLUMN IF NOT EXISTS `lateCheckOutFeeType`   VARCHAR(191)    NULL DEFAULT 'fixed',
    ADD COLUMN IF NOT EXISTS `lateCheckOutFeeAmount` DECIMAL(10, 2)  NULL,
    ADD COLUMN IF NOT EXISTS `timezone`              VARCHAR(191)    NOT NULL DEFAULT 'Asia/Bangkok';

-- ─── 2. Bookings: Time-aware + early/late checkout columns ───────────────────
ALTER TABLE `bookings`
    ADD COLUMN IF NOT EXISTS `scheduledCheckIn`       DATETIME(3)    NULL,
    ADD COLUMN IF NOT EXISTS `scheduledCheckOut`      DATETIME(3)    NULL,
    ADD COLUMN IF NOT EXISTS `requestedEarlyCheckIn`  TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `approvedEarlyCheckIn`   TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `earlyCheckInFee`        DECIMAL(10, 2) NULL,
    ADD COLUMN IF NOT EXISTS `requestedLateCheckOut`  TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `approvedLateCheckOut`   TINYINT(1)    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS `lateCheckOutFee`        DECIMAL(10, 2) NULL;

CREATE INDEX IF NOT EXISTS `bookings_scheduledCheckIn_idx` ON `bookings`(`scheduledCheckIn`);
CREATE INDEX IF NOT EXISTS `bookings_scheduledCheckOut_idx` ON `bookings`(`scheduledCheckOut`);

-- ─── 3. Staff table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `staff` (
    `id`              VARCHAR(191) NOT NULL,
    `tenantId`        VARCHAR(191) NOT NULL,
    `firstName`       VARCHAR(191) NOT NULL,
    `lastName`        VARCHAR(191) NOT NULL,
    `email`           VARCHAR(191) NOT NULL,
    `phone`           VARCHAR(191) NULL,
    `role`            VARCHAR(191) NOT NULL,
    `department`      VARCHAR(191) NULL,
    `employeeCode`    VARCHAR(191) NULL,
    `status`          VARCHAR(191) NOT NULL DEFAULT 'active',
    `shiftType`       VARCHAR(191) NULL,
    `maxTasksPerShift` INT         NULL DEFAULT 8,
    `specializations` TEXT         NULL,
    `rating`          DECIMAL(3, 2) NULL,
    `efficiency`      INT          NULL DEFAULT 100,
    `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`       DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `staff_tenantId_idx` (`tenantId`),
    INDEX `staff_status_idx` (`status`),
    INDEX `staff_department_idx` (`department`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 4. MaintenanceTask table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `maintenance_tasks` (
    `id`               VARCHAR(191) NOT NULL,
    `tenantId`         VARCHAR(191) NOT NULL,
    `propertyId`       VARCHAR(191) NOT NULL,
    `roomId`           VARCHAR(191) NULL,
    `title`            VARCHAR(191) NOT NULL,
    `description`      TEXT         NULL,
    `category`         VARCHAR(191) NOT NULL,
    `priority`         VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status`           VARCHAR(191) NOT NULL DEFAULT 'pending',
    `assignedToId`     VARCHAR(191) NULL,
    `requestedDate`    DATETIME(3)  NULL,
    `scheduledDate`    DATETIME(3)  NULL,
    `estimatedDuration` INT         NULL,
    `startedAt`        DATETIME(3)  NULL,
    `completedAt`      DATETIME(3)  NULL,
    `actualDuration`   INT          NULL,
    `estimatedCost`    DECIMAL(10, 2) NULL,
    `actualCost`       DECIMAL(10, 2) NULL,
    `partsUsed`        TEXT         NULL,
    `inspectedById`    VARCHAR(191) NULL,
    `inspectedAt`      DATETIME(3)  NULL,
    `rating`           INT          NULL,
    `inspectionNotes`  TEXT         NULL,
    `notes`            TEXT         NULL,
    `attachments`      TEXT         NULL,
    `createdAt`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`        DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `maintenance_tasks_tenantId_idx` (`tenantId`),
    INDEX `maintenance_tasks_propertyId_idx` (`propertyId`),
    INDEX `maintenance_tasks_roomId_idx` (`roomId`),
    INDEX `maintenance_tasks_status_idx` (`status`),
    INDEX `maintenance_tasks_category_idx` (`category`),
    INDEX `maintenance_tasks_assignedToId_idx` (`assignedToId`),

    CONSTRAINT `maintenance_tasks_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_roomId_fkey`     FOREIGN KEY (`roomId`)     REFERENCES `rooms`(`id`)      ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `maintenance_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── 5. HousekeepingTask: new columns ────────────────────────────────────────
ALTER TABLE `housekeeping_tasks`
    ADD COLUMN IF NOT EXISTS `bookingId`        VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `scheduledFor`     DATETIME(3)  NULL,
    ADD COLUMN IF NOT EXISTS `roomReadyAt`      DATETIME(3)  NULL,
    ADD COLUMN IF NOT EXISTS `actualStartTime`  DATETIME(3)  NULL,
    ADD COLUMN IF NOT EXISTS `actualEndTime`    DATETIME(3)  NULL,
    ADD COLUMN IF NOT EXISTS `actualDuration`   INT          NULL,
    ADD COLUMN IF NOT EXISTS `inspectedById`    VARCHAR(191) NULL;

-- Foreign keys for HousekeepingTask new columns
ALTER TABLE `housekeeping_tasks`
    ADD CONSTRAINT IF NOT EXISTS `housekeeping_tasks_bookingId_fkey`
        FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT IF NOT EXISTS `housekeeping_tasks_inspectedById_fkey`
        FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- assignedTo relation in housekeeping_tasks also points to staff (if column exists)
ALTER TABLE `housekeeping_tasks`
    ADD CONSTRAINT IF NOT EXISTS `housekeeping_tasks_assignedToId_staff_fkey`
        FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS `housekeeping_tasks_bookingId_idx`    ON `housekeeping_tasks`(`bookingId`);
CREATE INDEX IF NOT EXISTS `housekeeping_tasks_scheduledFor_idx` ON `housekeeping_tasks`(`scheduledFor`);

-- ─── 6. BookingAddOn table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `booking_add_ons` (
    `id`          VARCHAR(191) NOT NULL,
    `bookingId`   VARCHAR(191) NOT NULL,
    `type`        VARCHAR(191) NOT NULL,
    `amount`      DECIMAL(10, 2) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3)  NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `booking_add_ons_bookingId_idx` (`bookingId`),
    CONSTRAINT `booking_add_ons_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
