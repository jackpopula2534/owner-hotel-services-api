-- Camp Sub-System (CampSync): ระบบจัดการลานกางแคมป์

-- CreateTable
CREATE TABLE `camp_grounds` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `name` VARCHAR(180) NOT NULL,
    `description` TEXT NULL,
    `address` VARCHAR(255) NULL,
    `phone` VARCHAR(30) NULL,
    `latitude` DOUBLE NULL,
    `longitude` DOUBLE NULL,
    `mapImageUrl` VARCHAR(500) NULL,
    `mapWidth` INTEGER NULL,
    `mapHeight` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `checkInTime` VARCHAR(10) NULL DEFAULT '14:00',
    `checkOutTime` VARCHAR(10) NULL DEFAULT '12:00',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `camp_grounds_tenantId_idx`(`tenantId`),
    INDEX `camp_grounds_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_zones` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(30) NOT NULL DEFAULT 'lawn',
    `description` TEXT NULL,
    `basePrice` DECIMAL(10, 2) NOT NULL,
    `weekendPrice` DECIMAL(10, 2) NULL,
    `maxGuests` INTEGER NOT NULL DEFAULT 4,
    `maxTents` INTEGER NOT NULL DEFAULT 1,
    `allowVehicle` BOOLEAN NOT NULL DEFAULT false,
    `allowPet` BOOLEAN NOT NULL DEFAULT false,
    `color` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `camp_zones_tenantId_idx`(`tenantId`),
    INDEX `camp_zones_campgroundId_idx`(`campgroundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_pitches` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'available',
    `posX` DOUBLE NOT NULL DEFAULT 0.5,
    `posY` DOUBLE NOT NULL DEFAULT 0.5,
    `sizeSqm` DOUBLE NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `camp_pitches_campgroundId_code_key`(`campgroundId`, `code`),
    INDEX `camp_pitches_tenantId_idx`(`tenantId`),
    INDEX `camp_pitches_zoneId_idx`(`zoneId`),
    INDEX `camp_pitches_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_reservations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `zoneId` VARCHAR(36) NULL,
    `pitchId` VARCHAR(36) NOT NULL,
    `reservationNo` VARCHAR(30) NULL,
    `guestId` VARCHAR(36) NULL,
    `guestFirstName` VARCHAR(120) NOT NULL,
    `guestLastName` VARCHAR(120) NULL,
    `guestEmail` VARCHAR(180) NULL,
    `guestPhone` VARCHAR(30) NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `scheduledCheckIn` DATETIME(3) NULL,
    `scheduledCheckOut` DATETIME(3) NULL,
    `actualCheckIn` DATETIME(3) NULL,
    `actualCheckOut` DATETIME(3) NULL,
    `numGuests` INTEGER NOT NULL DEFAULT 1,
    `numTents` INTEGER NOT NULL DEFAULT 1,
    `numVehicles` INTEGER NOT NULL DEFAULT 0,
    `hasPet` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `totalPrice` DECIMAL(10, 2) NOT NULL,
    `addons` JSON NULL,
    `paymentStatus` VARCHAR(20) NULL DEFAULT 'pending',
    `paymentMethod` VARCHAR(30) NULL,
    `amountPaid` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `camp_reservations_tenantId_idx`(`tenantId`),
    INDEX `camp_reservations_campgroundId_idx`(`campgroundId`),
    INDEX `camp_reservations_pitchId_idx`(`pitchId`),
    INDEX `camp_reservations_status_idx`(`status`),
    INDEX `camp_reservations_checkIn_checkOut_idx`(`checkIn`, `checkOut`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_zones` ADD CONSTRAINT `camp_zones_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_pitches` ADD CONSTRAINT `camp_pitches_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_pitches` ADD CONSTRAINT `camp_pitches_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `camp_zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_reservations` ADD CONSTRAINT `camp_reservations_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_reservations` ADD CONSTRAINT `camp_reservations_pitchId_fkey` FOREIGN KEY (`pitchId`) REFERENCES `camp_pitches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
