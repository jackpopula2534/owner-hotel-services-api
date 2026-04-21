-- CreateIndex
CREATE UNIQUE INDEX `price_comparisons_tenantId_purchaseRequisitionId_key` ON `price_comparisons`(`tenantId`, `purchaseRequisitionId`);
