/*
  Warnings:

  - You are about to drop the column `vipLevel` on the `guests` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `guests` DROP COLUMN `vipLevel`,
    ADD COLUMN `vehiclePlateNumber` VARCHAR(191) NULL;
