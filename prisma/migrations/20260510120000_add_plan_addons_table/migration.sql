-- CreateTable: plan_addons (assign Add-ons to Plans so each plan can include selected add-ons)
CREATE TABLE `plan_addons` (
    `id` VARCHAR(36) NOT NULL,
    `plan_id` VARCHAR(36) NOT NULL,
    `addon_id` VARCHAR(36) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_plan_addons_plan_addon`(`plan_id`, `addon_id`),
    INDEX `IDX_plan_addons_plan_id`(`plan_id`),
    INDEX `IDX_plan_addons_addon_id`(`addon_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `plan_addons`
    ADD CONSTRAINT `FK_plan_addons_plan_id`
    FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE `plan_addons`
    ADD CONSTRAINT `FK_plan_addons_addon_id`
    FOREIGN KEY (`addon_id`) REFERENCES `add_ons`(`id`)
    ON DELETE CASCADE ON UPDATE NO ACTION;
