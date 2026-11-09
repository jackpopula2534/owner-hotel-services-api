-- Log of table moves on a booking (POS: ใบการจอง → ย้ายโต๊ะ). Each move keeps
-- from/to table, the reason staff gave, when and who — shown on the timeline.
ALTER TABLE `table_reservations` ADD COLUMN `tableMoves` JSON NULL;
