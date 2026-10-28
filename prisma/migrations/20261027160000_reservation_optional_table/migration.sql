-- A booking can now be taken without a table; staff choose one when the party
-- orders (POS order dialog), and the booking is updated to that table.
ALTER TABLE `table_reservations` MODIFY `tableId` VARCHAR(191) NULL;
