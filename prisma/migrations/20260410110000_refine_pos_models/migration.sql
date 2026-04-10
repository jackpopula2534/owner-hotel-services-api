/*
  Warnings:

  - The primary key for the `kitchen_orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `priority` on the `kitchen_orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(10)` to `Enum(EnumId(8))`.
  - You are about to alter the column `status` on the `kitchen_orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(9))`.
  - The primary key for the `menu_categories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `name` on the `menu_categories` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(191)`.
  - You are about to alter the column `image` on the `menu_categories` table. The data in that column could be lost. The data in that column will be cast from `VarChar(500)` to `VarChar(191)`.
  - The primary key for the `menu_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `name` on the `menu_items` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(191)`.
  - You are about to alter the column `image` on the `menu_items` table. The data in that column could be lost. The data in that column will be cast from `VarChar(500)` to `VarChar(191)`.
  - The primary key for the `order_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `status` on the `order_items` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(9))`.
  - You are about to alter the column `notes` on the `order_items` table. The data in that column could be lost. The data in that column will be cast from `VarChar(500)` to `VarChar(191)`.
  - The primary key for the `orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `orderType` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(4))`.
  - You are about to alter the column `status` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(5))`.
  - You are about to alter the column `guestName` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(191)`.
  - You are about to alter the column `paymentStatus` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(6))`.
  - The primary key for the `restaurant_tables` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `shape` on the `restaurant_tables` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(1))`.
  - You are about to alter the column `status` on the `restaurant_tables` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(2))`.
  - You are about to alter the column `type` on the `restaurants` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(0))`.
  - The primary key for the `table_reservations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `guestName` on the `table_reservations` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(191)`.
  - You are about to alter the column `guestEmail` on the `table_reservations` table. The data in that column could be lost. The data in that column will be cast from `VarChar(200)` to `VarChar(191)`.
  - You are about to alter the column `status` on the `table_reservations` table. The data in that column could be lost. The data in that column will be cast from `VarChar(20)` to `Enum(EnumId(3))`.

*/
-- DropForeignKey
ALTER TABLE `kitchen_orders` DROP FOREIGN KEY `kitchen_orders_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `menu_categories` DROP FOREIGN KEY `menu_categories_restaurantId_fkey`;

-- DropForeignKey
ALTER TABLE `menu_items` DROP FOREIGN KEY `menu_items_categoryId_fkey`;

-- DropForeignKey
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_menuItemId_fkey`;

-- DropForeignKey
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_orderId_fkey`;

-- DropForeignKey
ALTER TABLE `orders` DROP FOREIGN KEY `orders_restaurantId_fkey`;

-- DropForeignKey
ALTER TABLE `orders` DROP FOREIGN KEY `orders_tableId_fkey`;

-- DropForeignKey
ALTER TABLE `restaurant_tables` DROP FOREIGN KEY `restaurant_tables_restaurantId_fkey`;

-- DropForeignKey
ALTER TABLE `table_reservations` DROP FOREIGN KEY `table_reservations_tableId_fkey`;

-- AlterTable
ALTER TABLE `kitchen_orders` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `orderId` VARCHAR(191) NOT NULL,
    MODIFY `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'RUSH') NOT NULL DEFAULT 'NORMAL',
    MODIFY `status` ENUM('PENDING', 'SENT', 'PREPARING', 'READY', 'SERVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    MODIFY `stationName` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `menu_categories` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `restaurantId` VARCHAR(191) NOT NULL,
    MODIFY `name` VARCHAR(191) NOT NULL,
    MODIFY `description` VARCHAR(191) NULL,
    MODIFY `image` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `menu_items` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `restaurantId` VARCHAR(191) NOT NULL,
    MODIFY `categoryId` VARCHAR(191) NOT NULL,
    MODIFY `name` VARCHAR(191) NOT NULL,
    MODIFY `image` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `order_items` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `orderId` VARCHAR(191) NOT NULL,
    MODIFY `menuItemId` VARCHAR(191) NOT NULL,
    MODIFY `status` ENUM('PENDING', 'SENT', 'PREPARING', 'READY', 'SERVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    MODIFY `notes` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `orders` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `restaurantId` VARCHAR(191) NOT NULL,
    MODIFY `tableId` VARCHAR(191) NULL,
    MODIFY `orderNumber` VARCHAR(191) NOT NULL,
    MODIFY `orderType` ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'ROOM_SERVICE') NOT NULL DEFAULT 'DINE_IN',
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    MODIFY `waiterId` VARCHAR(191) NULL,
    MODIFY `guestName` VARCHAR(191) NULL,
    MODIFY `guestRoom` VARCHAR(191) NULL,
    MODIFY `paymentStatus` ENUM('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED') NOT NULL DEFAULT 'UNPAID',
    MODIFY `paymentMethod` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `restaurant_tables` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `restaurantId` VARCHAR(191) NOT NULL,
    MODIFY `tableNumber` VARCHAR(191) NOT NULL,
    MODIFY `shape` ENUM('RECTANGLE', 'SQUARE', 'ROUND', 'OVAL') NOT NULL DEFAULT 'RECTANGLE',
    MODIFY `status` ENUM('AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE') NOT NULL DEFAULT 'AVAILABLE',
    MODIFY `zone` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `restaurants` MODIFY `type` ENUM('FINE_DINING', 'CASUAL', 'BUFFET', 'BAR', 'CAFE', 'POOL_BAR', 'ROOM_SERVICE') NOT NULL DEFAULT 'CASUAL',
    MODIFY `openTime` VARCHAR(191) NULL,
    MODIFY `closeTime` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `table_reservations` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(191) NOT NULL,
    MODIFY `tenantId` VARCHAR(191) NULL,
    MODIFY `restaurantId` VARCHAR(191) NOT NULL,
    MODIFY `tableId` VARCHAR(191) NOT NULL,
    MODIFY `guestName` VARCHAR(191) NOT NULL,
    MODIFY `guestPhone` VARCHAR(191) NULL,
    MODIFY `guestEmail` VARCHAR(191) NULL,
    MODIFY `startTime` VARCHAR(191) NOT NULL,
    MODIFY `endTime` VARCHAR(191) NULL,
    MODIFY `status` ENUM('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
    MODIFY `specialRequests` VARCHAR(191) NULL,
    ADD PRIMARY KEY (`id`);

-- CreateIndex
CREATE INDEX `orders_orderNumber_idx` ON `orders`(`orderNumber`);

-- AddForeignKey
ALTER TABLE `restaurant_tables` ADD CONSTRAINT `restaurant_tables_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `table_reservations` ADD CONSTRAINT `table_reservations_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `restaurant_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_categories` ADD CONSTRAINT `menu_categories_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `menu_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `restaurant_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kitchen_orders` ADD CONSTRAINT `kitchen_orders_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
