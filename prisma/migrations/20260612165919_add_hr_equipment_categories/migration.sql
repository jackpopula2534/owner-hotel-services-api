-- AlterTable: add nullable JSON column for HR equipment-requisition inventory category filter
ALTER TABLE `hr_approval_flows` ADD COLUMN `equipmentCategoryIds` JSON NULL;
