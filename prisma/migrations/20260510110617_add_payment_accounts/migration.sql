-- ============================================================================
-- Migration: add_payment_accounts
-- ----------------------------------------------------------------------------
-- เพิ่มตาราง `payment_accounts` รองรับ multi-account ต่อ property
-- (PromptPay หลายเลข + บัญชีธนาคารหลายบัญชี)
-- คงตาราง `payment_settings` เดิมไว้ — ใช้เก็บ toggle ของแต่ละช่องทาง + cash
-- instructions และ legacy default account สำหรับ backward compatibility
-- ============================================================================

CREATE TABLE `payment_accounts` (
  `id`            VARCHAR(191) NOT NULL,
  `propertyId`    VARCHAR(191) NOT NULL,
  `kind`          VARCHAR(20)  NOT NULL,
  `label`         VARCHAR(120) NULL,
  `promptpayId`   VARCHAR(20)  NULL,
  `bankCode`      VARCHAR(16)  NULL,
  `accountNumber` VARCHAR(20)  NULL,
  `accountName`   VARCHAR(200) NULL,
  `branch`        VARCHAR(120) NULL,
  `isDefault`     BOOLEAN      NOT NULL DEFAULT false,
  `isActive`      BOOLEAN      NOT NULL DEFAULT true,
  `sortOrder`     INT          NOT NULL DEFAULT 0,
  `createdAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `payment_accounts_propertyId_idx` (`propertyId`),
  INDEX `payment_accounts_propertyId_kind_idx` (`propertyId`, `kind`),
  CONSTRAINT `payment_accounts_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- (Optional) Backfill จาก payment_settings เดิม:
-- ถ้ามี promptpayId อยู่แล้ว สร้าง PaymentAccount เริ่มต้นให้
INSERT INTO `payment_accounts` (
  `id`, `propertyId`, `kind`, `promptpayId`, `accountName`,
  `isDefault`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`
)
SELECT
  UUID(),
  `propertyId`,
  'promptpay',
  `promptpayId`,
  COALESCE(`promptpayAccountName`, ''),
  true,
  true,
  0,
  NOW(3),
  NOW(3)
FROM `payment_settings`
WHERE `promptpayId` IS NOT NULL AND `promptpayId` <> '';
