-- เว็บไซต์ของลานกางเต็นท์: ผูก website_sites กับ camp_grounds + ที่มา/การชำระของการจองจากเว็บ
ALTER TABLE `website_sites` ADD COLUMN `campgroundId` VARCHAR(36) NULL;
CREATE UNIQUE INDEX `website_sites_campgroundId_key` ON `website_sites`(`campgroundId`);
ALTER TABLE `website_sites` ADD CONSTRAINT `website_sites_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `camp_reservations`
  ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'STAFF',
  ADD COLUMN `paymentRef` VARCHAR(64) NULL,
  ADD COLUMN `slipUrl` VARCHAR(500) NULL;
CREATE INDEX `camp_reservations_paymentRef_idx` ON `camp_reservations`(`paymentRef`);

-- add-on เว็บไซต์ใช้ได้ทั้งโรงแรมและลานกางเต็นท์
UPDATE `add_ons` SET `system` = 'BOTH' WHERE `code` = 'WEBSITE_BUILDER';
