-- CreateTable: Properties
CREATE TABLE `properties` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `properties_tenantId_code_key`(`tenantId`, `code`),
    INDEX `properties_tenantId_idx`(`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 2: Create default property for each existing tenant
INSERT INTO `properties` (`id`, `tenantId`, `name`, `code`, `isDefault`, `createdAt`, `updatedAt`)
SELECT
    UUID() as id,
    t.id as tenantId,
    CONCAT(t.name, ' - สาขาหลัก') as name,
    'MAIN' as code,
    true as isDefault,
    NOW(3) as createdAt,
    NOW(3) as updatedAt
FROM `tenants` t;

-- Step 3: Add propertyId column to rooms (nullable first)
ALTER TABLE `rooms` ADD COLUMN `propertyId` VARCHAR(191) NULL;

-- Step 4: Assign all existing rooms to their tenant's default property
UPDATE `rooms` r
INNER JOIN `properties` p ON r.tenantId = p.tenantId
SET r.propertyId = p.id
WHERE p.isDefault = true;

-- Step 5: Make propertyId required
ALTER TABLE `rooms` MODIFY COLUMN `propertyId` VARCHAR(191) NOT NULL;

-- Step 6: Drop global unique constraint on room number
ALTER TABLE `rooms` DROP INDEX `rooms_number_key`;

-- Step 7: Add per-property unique constraint
CREATE UNIQUE INDEX `rooms_propertyId_number_key` ON `rooms`(`propertyId`, `number`);

-- Step 8: Add propertyId index
CREATE INDEX `rooms_propertyId_idx` ON `rooms`(`propertyId`);

-- Step 9: Add foreign key for propertyId
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 10: Add new columns to bookings table (nullable first)
ALTER TABLE `bookings` ADD COLUMN `propertyId` VARCHAR(191) NULL;
ALTER TABLE `bookings` ADD COLUMN `guestFirstName` VARCHAR(191) NULL;
ALTER TABLE `bookings` ADD COLUMN `guestLastName` VARCHAR(191) NULL;
ALTER TABLE `bookings` ADD COLUMN `guestEmail` VARCHAR(191) NULL;
ALTER TABLE `bookings` ADD COLUMN `guestPhone` VARCHAR(191) NULL;

-- Step 11: Populate propertyId from room relationship
UPDATE `bookings` b
INNER JOIN `rooms` r ON b.roomId = r.id
SET b.propertyId = r.propertyId;

-- Step 12: Populate guest data from Guest table for existing bookings
UPDATE `bookings` b
INNER JOIN `guests` g ON b.guestId = g.id
SET
    b.guestFirstName = g.firstName,
    b.guestLastName = g.lastName,
    b.guestEmail = g.email,
    b.guestPhone = g.phone;

-- Step 13: Make required fields NOT NULL
ALTER TABLE `bookings` MODIFY COLUMN `propertyId` VARCHAR(191) NOT NULL;
ALTER TABLE `bookings` MODIFY COLUMN `guestFirstName` VARCHAR(191) NOT NULL;
ALTER TABLE `bookings` MODIFY COLUMN `guestLastName` VARCHAR(191) NOT NULL;

-- Step 14: Make guestId nullable (was required before)
ALTER TABLE `bookings` MODIFY COLUMN `guestId` VARCHAR(191) NULL;

-- Step 15: Add propertyId index
CREATE INDEX `bookings_propertyId_idx` ON `bookings`(`propertyId`);

-- Step 16: Add foreign key for propertyId
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 17: Update guest foreign key to allow NULL (SetNull on delete)
ALTER TABLE `bookings` DROP FOREIGN KEY `bookings_guestId_fkey`;
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_guestId_fkey`
    FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
