-- AlterTable: add logo height/offset/frame style/vertical align columns to document_settings
ALTER TABLE `document_settings`
  ADD COLUMN `logoHeight` INT NULL DEFAULT 40,
  ADD COLUMN `logoOffsetX` DOUBLE NULL DEFAULT 0,
  ADD COLUMN `logoOffsetY` DOUBLE NULL DEFAULT 0,
  ADD COLUMN `logoFrameStyle` VARCHAR(191) NOT NULL DEFAULT 'plain',
  ADD COLUMN `logoVerticalAlign` VARCHAR(191) NOT NULL DEFAULT 'center';
