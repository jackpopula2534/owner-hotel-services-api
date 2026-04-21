-- CreateTable: menu_item_recipes
CREATE TABLE `menu_item_recipes` (
    `id` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `servings` INTEGER NULL,
    `instructions` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `menu_item_recipes_menuItemId_key`(`menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: recipe_ingredients
CREATE TABLE `recipe_ingredients` (
    `id` VARCHAR(191) NOT NULL,
    `recipeId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 3) NULL,
    `unit` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `recipe_ingredients_recipeId_idx`(`recipeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: menu_item_recipes -> menu_items
ALTER TABLE `menu_item_recipes` ADD CONSTRAINT `menu_item_recipes_menuItemId_fkey`
    FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: recipe_ingredients -> menu_item_recipes
ALTER TABLE `recipe_ingredients` ADD CONSTRAINT `recipe_ingredients_recipeId_fkey`
    FOREIGN KEY (`recipeId`) REFERENCES `menu_item_recipes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
