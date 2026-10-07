-- โปรโมชั่น Retail Phase 3: แคมเปญ CRM ออกโค้ด UNIQUE ให้สมาชิกทีละคน + ติดตาม sent → redeemed
-- แผน: docs/RETAIL_PROMOTIONS_PLAN.md

-- AlterTable
ALTER TABLE `crm_campaigns` ADD COLUMN `promoCodeValidDays` INTEGER NULL,
    ADD COLUMN `promotionId` VARCHAR(36) NULL;

-- AlterTable
ALTER TABLE `retail_promo_codes` ADD COLUMN `campaignDeliveryId` VARCHAR(36) NULL,
    ADD COLUMN `campaignId` VARCHAR(36) NULL;

-- CreateIndex
CREATE INDEX `crm_campaigns_promotionId_idx` ON `crm_campaigns`(`promotionId`);

-- CreateIndex
CREATE UNIQUE INDEX `retail_promo_codes_campaignDeliveryId_key` ON `retail_promo_codes`(`campaignDeliveryId`);

-- CreateIndex
CREATE INDEX `retail_promo_codes_campaignId_idx` ON `retail_promo_codes`(`campaignId`);

-- CreateIndex
CREATE INDEX `retail_promo_codes_issuedToGuestId_idx` ON `retail_promo_codes`(`issuedToGuestId`);
