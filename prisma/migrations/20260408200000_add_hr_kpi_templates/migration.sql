-- CreateTable: hr_kpi_templates
CREATE TABLE `hr_kpi_templates` (
    `id`             VARCHAR(191) NOT NULL,
    `tenantId`       VARCHAR(191) NULL,
    `name`           VARCHAR(191) NOT NULL,
    `nameEn`         VARCHAR(191) NULL,
    `departmentCode` VARCHAR(191) NULL,
    `positionCode`   VARCHAR(191) NULL,
    `periodType`     VARCHAR(191) NOT NULL DEFAULT 'quarterly',
    `description`    TEXT         NULL,
    `isDefault`      BOOLEAN      NOT NULL DEFAULT false,
    `isActive`       BOOLEAN      NOT NULL DEFAULT true,
    `sortOrder`      INTEGER      NOT NULL DEFAULT 0,
    `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`      DATETIME(3)  NOT NULL,

    INDEX `hr_kpi_templates_tenantId_idx`(`tenantId`),
    INDEX `hr_kpi_templates_departmentCode_idx`(`departmentCode`),
    INDEX `hr_kpi_templates_isDefault_idx`(`isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: hr_kpi_template_items
CREATE TABLE `hr_kpi_template_items` (
    `id`          VARCHAR(191) NOT NULL,
    `templateId`  VARCHAR(191) NOT NULL,
    `name`        VARCHAR(191) NOT NULL,
    `nameEn`      VARCHAR(191) NULL,
    `description` TEXT         NULL,
    `weight`      DECIMAL(5,2) NOT NULL DEFAULT 20,
    `minScore`    DECIMAL(5,2) NOT NULL DEFAULT 0,
    `maxScore`    DECIMAL(5,2) NOT NULL DEFAULT 100,
    `sortOrder`   INTEGER      NOT NULL DEFAULT 0,
    `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3)  NOT NULL,

    INDEX `hr_kpi_template_items_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_kpi_template_items`
    ADD CONSTRAINT `hr_kpi_template_items_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `hr_kpi_templates`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
