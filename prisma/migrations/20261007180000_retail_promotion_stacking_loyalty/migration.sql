-- โปรโมชั่น Retail Phase 4: โปรอัตโนมัติ (ของแถม) + ใช้ร่วมกัน, แลกแต้มเป็นโค้ด,
-- แต้มจากบิลร้านค้า และ tier คิดจากแต้มสะสมตลอดชีพ
-- แผน: docs/RETAIL_PROMOTIONS_PLAN.md

-- AlterTable
ALTER TABLE `retail_promotions` ADD COLUMN `autoApply` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `stackable` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pointsCost` INTEGER NULL;

-- CreateIndex
CREATE INDEX `retail_promotions_tenantId_autoApply_status_idx` ON `retail_promotions`(`tenantId`, `autoApply`, `status`);

-- AlterTable
ALTER TABLE `retail_promo_codes` ADD COLUMN `pointsSpent` INTEGER NULL;

-- บิลหนึ่งมีได้หลาย redemption (โค้ด 1 + โปรอัตโนมัติ) แต่โปรเดียวกันซ้ำในบิลไม่ได้
-- CreateIndex
CREATE INDEX `retail_promotion_redemptions_saleId_idx` ON `retail_promotion_redemptions`(`saleId`);

-- CreateIndex
CREATE UNIQUE INDEX `retail_promotion_redemptions_saleId_promotionId_key` ON `retail_promotion_redemptions`(`saleId`, `promotionId`);

-- DropIndex
DROP INDEX `retail_promotion_redemptions_saleId_key` ON `retail_promotion_redemptions`;

-- AlterTable
ALTER TABLE `retail_promotion_redemptions` MODIFY `promoCodeId` VARCHAR(191) NULL,
    MODIFY `code` VARCHAR(40) NULL,
    MODIFY `guestId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `retail_sales` ADD COLUMN `pointsEarned` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `loyalty_transactions` ADD COLUMN `retailSaleId` VARCHAR(36) NULL;

-- CreateIndex
CREATE INDEX `loyalty_transactions_retailSaleId_idx` ON `loyalty_transactions`(`retailSaleId`);

-- AlterTable
ALTER TABLE `loyalty_points` ADD COLUMN `lifetimePoints` INTEGER NOT NULL DEFAULT 0;

-- Backfill: แต้มสะสมตลอดชีพ = แต้มที่ได้รับ (earn) หักแต้มที่ถูกดึงคืนจากการย้อนเช็คเอาต์
-- ไม่น้อยกว่ายอดคงเหลือปัจจุบัน (ยอดที่เคยปรับเพิ่มด้วยมือนับเป็นแต้มสะสมด้วย)
UPDATE `loyalty_points` lp
LEFT JOIN (
    SELECT `tenantId`, `guestId`,
           SUM(CASE WHEN `type` = 'earn' OR (`type` = 'adjust' AND `reason` = 'checkout_undo') THEN `points` ELSE 0 END) AS earned
    FROM `loyalty_transactions`
    GROUP BY `tenantId`, `guestId`
) t ON t.`tenantId` = lp.`tenantId` AND t.`guestId` = lp.`guestId`
SET lp.`lifetimePoints` = GREATEST(lp.`points`, COALESCE(t.earned, 0), 0)
WHERE lp.`guestId` IS NOT NULL;

-- คิด tier ใหม่จากแต้มสะสมตลอดชีพ (สมาชิกที่เคยแลกแต้มจน tier ตก ได้ tier คืน)
UPDATE `loyalty_points`
SET `tier` = CASE
    WHEN `lifetimePoints` >= 10000 THEN 'platinum'
    WHEN `lifetimePoints` >= 5000 THEN 'gold'
    WHEN `lifetimePoints` >= 1000 THEN 'silver'
    ELSE 'standard'
END
WHERE `guestId` IS NOT NULL;
