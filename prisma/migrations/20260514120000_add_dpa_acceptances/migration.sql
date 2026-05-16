CREATE TABLE `dpa_acceptances` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `version` VARCHAR(20) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `ipAddress` VARCHAR(45) NULL,
  `userAgent` TEXT NULL,
  `acceptedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

  UNIQUE INDEX `dpa_acceptances_tenantId_version_key`(`tenantId`, `version`),
  INDEX `dpa_acceptances_tenantId_idx`(`tenantId`),
  INDEX `dpa_acceptances_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
