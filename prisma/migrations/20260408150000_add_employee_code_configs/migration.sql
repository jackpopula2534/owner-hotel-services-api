-- CreateTable
CREATE TABLE `employee_code_configs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `pattern` VARCHAR(191) NOT NULL DEFAULT '{PREFIX}-{NNNN}',
    `prefix` VARCHAR(191) NOT NULL DEFAULT 'EMP',
    `separator` VARCHAR(191) NOT NULL DEFAULT '-',
    `digitLength` INTEGER NOT NULL DEFAULT 4,
    `resetCycle` VARCHAR(191) NOT NULL DEFAULT 'NEVER',
    `nextNumber` INTEGER NOT NULL DEFAULT 1,
    `lastResetDate` DATETIME(3) NULL,
    `includeYear` BOOLEAN NOT NULL DEFAULT false,
    `yearFormat` VARCHAR(191) NOT NULL DEFAULT 'YYYY',
    `includeDept` BOOLEAN NOT NULL DEFAULT false,
    `deptSource` VARCHAR(191) NOT NULL DEFAULT 'CODE',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sampleOutput` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_code_configs_tenantId_key`(`tenantId`),
    INDEX `employee_code_configs_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
