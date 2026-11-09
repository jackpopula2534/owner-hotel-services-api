-- เช็คอินแบบหน้าเดียว: ตรวจบัตร, คีย์การ์ด, เงินประกัน, เช็คอินก่อนห้องพร้อม
ALTER TABLE `bookings`
  ADD COLUMN `idVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `idVerifiedBy` VARCHAR(36) NULL,
  ADD COLUMN `keyCards` INTEGER NULL,
  ADD COLUMN `depositAmount` DECIMAL(10, 2) NULL,
  ADD COLUMN `depositMethod` VARCHAR(20) NULL,
  ADD COLUMN `depositReturnedAt` DATETIME(3) NULL,
  ADD COLUMN `awaitingRoomSince` DATETIME(3) NULL;
