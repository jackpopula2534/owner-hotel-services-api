-- CreateTable
CREATE TABLE `hr_probation_checkpoint_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `checkpointId` VARCHAR(191) NOT NULL,
    `competency` VARCHAR(191) NOT NULL,
    `score` DECIMAL(5, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_probation_checkpoint_ratings_tenantId_idx`(`tenantId`),
    INDEX `hr_probation_checkpoint_ratings_checkpointId_idx`(`checkpointId`),
    UNIQUE INDEX `hr_probation_checkpoint_ratings_checkpointId_competency_key`(`checkpointId`, `competency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_probation_checkpoint_ratings` ADD CONSTRAINT `hr_probation_checkpoint_ratings_checkpointId_fkey` FOREIGN KEY (`checkpointId`) REFERENCES `hr_probation_checkpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
