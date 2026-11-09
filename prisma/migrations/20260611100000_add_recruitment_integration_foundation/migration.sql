-- AlterTable
ALTER TABLE `hr_departments` ADD COLUMN `costCenterId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `hr_equipment_requests` ADD COLUMN `purchaseRequisitionId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `warehouse_stocks` ADD COLUMN `reservedQty` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `hr_departments_costCenterId_idx` ON `hr_departments`(`costCenterId`);

-- AddForeignKey
ALTER TABLE `hr_departments` ADD CONSTRAINT `hr_departments_costCenterId_fkey` FOREIGN KEY (`costCenterId`) REFERENCES `cost_centers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
