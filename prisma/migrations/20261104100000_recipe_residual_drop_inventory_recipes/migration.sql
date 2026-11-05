-- เศษการใช้วัตถุดิบตามสูตร (ไม่ครบ 1 หน่วยสต็อก) — สะสมไว้แล้วตัดเมื่อครบหน่วย
CREATE TABLE `recipe_consumption_residuals` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `pendingQty` DECIMAL(14, 6) NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recipe_residual_wh_item_key`(`warehouseId`, `itemId`),
    INDEX `recipe_consumption_residuals_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- สูตรชุดเก่าของคลัง (inventory_recipes) ไม่มีหน้าจอไหนใช้ — สูตรจริงอยู่ที่ menu_item_recipes
ALTER TABLE `inventory_recipe_ingredients` DROP FOREIGN KEY `inventory_recipe_ingredients_recipeId_fkey`;
ALTER TABLE `inventory_recipe_ingredients` DROP FOREIGN KEY `inventory_recipe_ingredients_itemId_fkey`;
DROP TABLE `inventory_recipe_ingredients`;
DROP TABLE `inventory_recipes`;
