-- CreateTable
CREATE TABLE `addon_trial_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `addon_code` VARCHAR(191) NOT NULL,
    `addon_name` VARCHAR(191) NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
    `note` TEXT NULL,
    `admin_note` TEXT NULL,
    `approved_by` VARCHAR(191) NULL,
    `approved_at` DATETIME(6) NULL,
    `expires_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `addon_trial_requests_tenant_id_idx`(`tenant_id`),
    INDEX `addon_trial_requests_status_idx`(`status`),
    INDEX `addon_trial_requests_tenant_id_addon_code_idx`(`tenant_id`, `addon_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
