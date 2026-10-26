-- AlterTable
ALTER TABLE `camp_pitches` ADD COLUMN `rotation` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `widthM` DOUBLE NULL,
    ADD COLUMN `depthM` DOUBLE NULL;

-- AlterTable
ALTER TABLE `camp_facilities` ADD COLUMN `rotation` DOUBLE NOT NULL DEFAULT 0;
