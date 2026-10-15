-- CRM แคมเปญออกโค้ดห้องพักเฉพาะบุคคล
ALTER TABLE `property_promo_codes`
  ADD COLUMN `parentId` VARCHAR(36) NULL,
  ADD COLUMN `issuedToGuestId` VARCHAR(36) NULL,
  ADD COLUMN `campaignId` VARCHAR(36) NULL,
  ADD COLUMN `campaignDeliveryId` VARCHAR(36) NULL;

CREATE UNIQUE INDEX `property_promo_codes_campaignDeliveryId_key` ON `property_promo_codes`(`campaignDeliveryId`);
CREATE INDEX `property_promo_codes_parentId_idx` ON `property_promo_codes`(`parentId`);
CREATE INDEX `property_promo_codes_campaignId_idx` ON `property_promo_codes`(`campaignId`);
CREATE INDEX `property_promo_codes_issuedToGuestId_idx` ON `property_promo_codes`(`issuedToGuestId`);

ALTER TABLE `crm_campaigns` ADD COLUMN `roomPromoCodeId` VARCHAR(36) NULL;
CREATE INDEX `crm_campaigns_roomPromoCodeId_idx` ON `crm_campaigns`(`roomPromoCodeId`);
