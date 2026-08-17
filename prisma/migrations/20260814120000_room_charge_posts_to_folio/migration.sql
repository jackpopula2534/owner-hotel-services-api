-- Room charges now land on a guest folio instead of vanishing.
--
-- Both tills (restaurant POS and the retail shop) accepted ROOM_CHARGE, wrote a
-- room number as free text, and marked the sale settled. Nothing was ever posted
-- to `guest_folios` / `folio_charges` — `GuestFolioService.createForBooking` was
-- called from nowhere in the codebase — so the guest was never billed at
-- checkout and the money left the books entirely.
--
-- Two changes support the fix:
--
-- 1. `CHARGED_TO_ROOM` on `orders.paymentStatus`. A bill signed to a room is
--    revenue the moment it closes, but no cash crossed the counter — collapsing
--    it into PAID would overstate the drawer, and leaving it UNPAID would drop it
--    out of every revenue report. It needs its own state. Reports that mean
--    "รายได้" now match on PAID + CHARGED_TO_ROOM; reports that mean "เงินสดรับ"
--    still match on PAID alone (see common/constants/revenue-recognition.const.ts).
--
-- 2. The folio back-references. `bookingId` is the charge's real anchor —
--    `guestRoom` stays a display snapshot for the receipt and must never be what
--    the accounting joins on, because room numbers get reused every night.
--    `folioId`/`folioChargeId` being null is the readable signal that a bill has
--    not been carried to a room yet.

-- AlterEnum
ALTER TABLE `orders`
  MODIFY `paymentStatus` ENUM('UNPAID', 'PARTIAL', 'PAID', 'CHARGED_TO_ROOM', 'REFUNDED')
  NOT NULL DEFAULT 'UNPAID';

-- AlterTable
ALTER TABLE `orders`
  ADD COLUMN `bookingId` VARCHAR(191) NULL,
  ADD COLUMN `folioId` VARCHAR(191) NULL,
  ADD COLUMN `folioChargeId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `orders_bookingId_idx` ON `orders`(`bookingId`);

-- AlterTable
-- retail_sales already carried roomNumber/bookingId/folioId from the day the
-- ROOM_CHARGE method was added; only the posted charge itself had nowhere to go.
ALTER TABLE `retail_sales`
  ADD COLUMN `folioChargeId` VARCHAR(191) NULL;
