-- AlterTable
ALTER TABLE `suppliers` MODIFY `emoji` VARCHAR(191) NULL DEFAULT '🏢';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `approvalLimit` DECIMAL(12, 2) NULL,
    ADD COLUMN `procurementPermissions` TEXT NULL;

-- CreateTable
CREATE TABLE `approval_flows` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `documentType` ENUM('PURCHASE_REQUISITION', 'PRICE_COMPARISON', 'PURCHASE_ORDER') NOT NULL,
    `minAmount` DECIMAL(12, 2) NULL,
    `maxAmount` DECIMAL(12, 2) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `approval_flows_tenantId_documentType_idx`(`tenantId`, `documentType`),
    INDEX `approval_flows_tenantId_isActive_idx`(`tenantId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_flow_steps` (
    `id` VARCHAR(191) NOT NULL,
    `flowId` VARCHAR(191) NOT NULL,
    `stepOrder` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `approverType` ENUM('SPECIFIC_USER', 'ROLE', 'DEPARTMENT_HEAD') NOT NULL DEFAULT 'SPECIFIC_USER',
    `approverRole` VARCHAR(191) NULL,
    `minApprovals` INTEGER NOT NULL DEFAULT 1,
    `isParallel` BOOLEAN NOT NULL DEFAULT false,
    `slaHours` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `approval_flow_steps_flowId_idx`(`flowId`),
    UNIQUE INDEX `approval_flow_steps_flowId_stepOrder_key`(`flowId`, `stepOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_flow_step_approvers` (
    `id` VARCHAR(191) NOT NULL,
    `stepId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `approval_flow_step_approvers_userId_idx`(`userId`),
    UNIQUE INDEX `approval_flow_step_approvers_stepId_userId_key`(`stepId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `approval_flow_steps` ADD CONSTRAINT `approval_flow_steps_flowId_fkey` FOREIGN KEY (`flowId`) REFERENCES `approval_flows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_flow_step_approvers` ADD CONSTRAINT `approval_flow_step_approvers_stepId_fkey` FOREIGN KEY (`stepId`) REFERENCES `approval_flow_steps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_flow_step_approvers` ADD CONSTRAINT `approval_flow_step_approvers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
