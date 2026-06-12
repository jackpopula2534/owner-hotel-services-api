-- HR Approval Flow config (Setup Flow, 2026-06-10)
-- One row per (tenantId, flowType) storing ordered approval-role steps.
-- Defaults are created lazily by the API on first read per tenant.

CREATE TABLE `hr_approval_flows` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `flowType` VARCHAR(191) NOT NULL,
    `steps` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_approval_flows_tenantId_flowType_key`(`tenantId`, `flowType`),
    INDEX `hr_approval_flows_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
