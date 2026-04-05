-- AlterTable: Add payment tracking fields to bookings
ALTER TABLE `bookings`
    ADD COLUMN `paymentMethod` VARCHAR(191) NULL,
    ADD COLUMN `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    ADD COLUMN `amountPaid`    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `paymentNote`   VARCHAR(191) NULL;
