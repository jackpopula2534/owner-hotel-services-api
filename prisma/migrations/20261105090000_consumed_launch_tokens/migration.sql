-- Deep-link launch tokens (/auth/<system>-launch) are single-use: the exchange
-- records each token's jti here and a replay hits the primary key (FIND-04).
CREATE TABLE `consumed_launch_tokens` (
  `jti` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`jti`),
  INDEX `consumed_launch_tokens_expiresAt_idx` (`expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
