-- Link a dine-in order back to the table reservation it was opened for.
-- Walk-in orders keep reservationId NULL. This is what lets seating a
-- reservation open a bill, and closing that bill complete the reservation
-- and release the table.

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `reservationId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `orders_reservationId_idx` ON `orders`(`reservationId`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `table_reservations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
