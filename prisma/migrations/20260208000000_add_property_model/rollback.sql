-- ROLLBACK SCRIPT
-- Use this if migration fails or needs to be reverted

-- Step 1: Remove foreign key constraints from bookings
ALTER TABLE `bookings` DROP FOREIGN KEY `bookings_propertyId_fkey`;

-- Step 2: Restore original guest foreign key
ALTER TABLE `bookings` DROP FOREIGN KEY `bookings_guestId_fkey`;
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_guestId_fkey`
    FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 3: Remove booking indexes
DROP INDEX `bookings_propertyId_idx` ON `bookings`;

-- Step 4: Make guestId required again
UPDATE `bookings` SET `guestId` = (
    SELECT g.id FROM `guests` g
    WHERE g.firstName = `bookings`.guestFirstName
    AND g.lastName = `bookings`.guestLastName
    AND g.tenantId = `bookings`.tenantId
    LIMIT 1
) WHERE `guestId` IS NULL;

ALTER TABLE `bookings` MODIFY COLUMN `guestId` VARCHAR(191) NOT NULL;

-- Step 5: Drop booking columns
ALTER TABLE `bookings` DROP COLUMN `propertyId`;
ALTER TABLE `bookings` DROP COLUMN `guestFirstName`;
ALTER TABLE `bookings` DROP COLUMN `guestLastName`;
ALTER TABLE `bookings` DROP COLUMN `guestEmail`;
ALTER TABLE `bookings` DROP COLUMN `guestPhone`;

-- Step 6: Remove room foreign key and indexes
ALTER TABLE `rooms` DROP FOREIGN KEY `rooms_propertyId_fkey`;
DROP INDEX `rooms_propertyId_idx` ON `rooms`;
DROP INDEX `rooms_propertyId_number_key` ON `rooms`;

-- Step 7: Restore global unique constraint on room number
CREATE UNIQUE INDEX `rooms_number_key` ON `rooms`(`number`);

-- Step 8: Remove propertyId from rooms
ALTER TABLE `rooms` DROP COLUMN `propertyId`;

-- Step 9: Drop properties table
DROP TABLE `properties`;
