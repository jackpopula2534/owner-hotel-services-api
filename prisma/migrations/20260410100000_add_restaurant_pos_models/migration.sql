-- ============================================================
-- Migration: add_restaurant_pos_models
-- Created: 2026-04-10
-- Description: Add Restaurant enums + POS models
--   RestaurantTable, TableReservation, MenuCategory, MenuItem,
--   Order, OrderItem, KitchenOrder
--   + Update restaurants table with new fields
-- ============================================================

-- ─── Update restaurants table ───────────────────────────────
ALTER TABLE `restaurants`
  ADD COLUMN `type`        VARCHAR(20)  NOT NULL DEFAULT 'CASUAL',
  ADD COLUMN `openTime`    VARCHAR(5)   NULL,
  ADD COLUMN `closeTime`   VARCHAR(5)   NULL,
  ADD COLUMN `isActive`    BOOLEAN      NOT NULL DEFAULT TRUE,
  ADD COLUMN `layoutData`  JSON         NULL;

-- ─── RestaurantTable ───────────────────────────────────────
CREATE TABLE `restaurant_tables` (
  `id`           VARCHAR(36)  NOT NULL,
  `tenantId`     VARCHAR(36)  NULL,
  `restaurantId` VARCHAR(36)  NOT NULL,
  `tableNumber`  VARCHAR(20)  NOT NULL,
  `capacity`     INT          NOT NULL,
  `shape`        VARCHAR(20)  NOT NULL DEFAULT 'RECTANGLE',
  `status`       VARCHAR(20)  NOT NULL DEFAULT 'AVAILABLE',
  `positionX`    DOUBLE       NULL,
  `positionY`    DOUBLE       NULL,
  `width`        DOUBLE       NULL,
  `height`       DOUBLE       NULL,
  `rotation`     DOUBLE       NULL DEFAULT 0,
  `zone`         VARCHAR(100) NULL,
  `isActive`     BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `restaurant_tables_restaurantId_tableNumber_key` (`restaurantId`, `tableNumber`),
  INDEX `restaurant_tables_tenantId_idx` (`tenantId`),
  INDEX `restaurant_tables_restaurantId_idx` (`restaurantId`),
  INDEX `restaurant_tables_status_idx` (`status`),
  CONSTRAINT `restaurant_tables_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurants` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── TableReservation ──────────────────────────────────────
CREATE TABLE `table_reservations` (
  `id`              VARCHAR(36)   NOT NULL,
  `tenantId`        VARCHAR(36)   NULL,
  `restaurantId`    VARCHAR(36)   NOT NULL,
  `tableId`         VARCHAR(36)   NOT NULL,
  `guestName`       VARCHAR(200)  NOT NULL,
  `guestPhone`      VARCHAR(50)   NULL,
  `guestEmail`      VARCHAR(200)  NULL,
  `partySize`       INT           NOT NULL,
  `reservationDate` DATE          NOT NULL,
  `startTime`       VARCHAR(5)    NOT NULL,
  `endTime`         VARCHAR(5)    NULL,
  `status`          VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `specialRequests` TEXT          NULL,
  `notes`           TEXT          NULL,
  `confirmedAt`     DATETIME(3)   NULL,
  `seatedAt`        DATETIME(3)   NULL,
  `completedAt`     DATETIME(3)   NULL,
  `cancelledAt`     DATETIME(3)   NULL,
  `createdAt`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)   NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `table_reservations_tenantId_idx` (`tenantId`),
  INDEX `table_reservations_restaurantId_idx` (`restaurantId`),
  INDEX `table_reservations_tableId_idx` (`tableId`),
  INDEX `table_reservations_reservationDate_idx` (`reservationDate`),
  INDEX `table_reservations_status_idx` (`status`),
  CONSTRAINT `table_reservations_tableId_fkey`
    FOREIGN KEY (`tableId`) REFERENCES `restaurant_tables` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── MenuCategory ──────────────────────────────────────────
CREATE TABLE `menu_categories` (
  `id`           VARCHAR(36)   NOT NULL,
  `tenantId`     VARCHAR(36)   NULL,
  `restaurantId` VARCHAR(36)   NOT NULL,
  `name`         VARCHAR(200)  NOT NULL,
  `description`  TEXT          NULL,
  `image`        VARCHAR(500)  NULL,
  `displayOrder` INT           NOT NULL DEFAULT 0,
  `isActive`     BOOLEAN       NOT NULL DEFAULT TRUE,
  `createdAt`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)   NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `menu_categories_tenantId_idx` (`tenantId`),
  INDEX `menu_categories_restaurantId_idx` (`restaurantId`),
  CONSTRAINT `menu_categories_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurants` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── MenuItem ──────────────────────────────────────────────
CREATE TABLE `menu_items` (
  `id`              VARCHAR(36)      NOT NULL,
  `tenantId`        VARCHAR(36)      NULL,
  `restaurantId`    VARCHAR(36)      NOT NULL,
  `categoryId`      VARCHAR(36)      NOT NULL,
  `name`            VARCHAR(200)     NOT NULL,
  `description`     TEXT             NULL,
  `price`           DECIMAL(10, 2)   NOT NULL,
  `cost`            DECIMAL(10, 2)   NULL,
  `image`           VARCHAR(500)     NULL,
  `preparationTime` INT              NULL,
  `calories`        INT              NULL,
  `allergens`       JSON             NULL,
  `isVegetarian`    BOOLEAN          NOT NULL DEFAULT FALSE,
  `isVegan`         BOOLEAN          NOT NULL DEFAULT FALSE,
  `isGlutenFree`    BOOLEAN          NOT NULL DEFAULT FALSE,
  `isSpicy`         BOOLEAN          NOT NULL DEFAULT FALSE,
  `spicyLevel`      INT              NULL,
  `isAvailable`     BOOLEAN          NOT NULL DEFAULT TRUE,
  `displayOrder`    INT              NOT NULL DEFAULT 0,
  `createdAt`       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)      NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `menu_items_tenantId_idx` (`tenantId`),
  INDEX `menu_items_restaurantId_idx` (`restaurantId`),
  INDEX `menu_items_categoryId_idx` (`categoryId`),
  INDEX `menu_items_isAvailable_idx` (`isAvailable`),
  CONSTRAINT `menu_items_categoryId_fkey`
    FOREIGN KEY (`categoryId`) REFERENCES `menu_categories` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── Order ─────────────────────────────────────────────────
CREATE TABLE `orders` (
  `id`            VARCHAR(36)      NOT NULL,
  `tenantId`      VARCHAR(36)      NULL,
  `restaurantId`  VARCHAR(36)      NOT NULL,
  `tableId`       VARCHAR(36)      NULL,
  `orderNumber`   VARCHAR(30)      NOT NULL,
  `orderType`     VARCHAR(20)      NOT NULL DEFAULT 'DINE_IN',
  `status`        VARCHAR(20)      NOT NULL DEFAULT 'PENDING',
  `waiterId`      VARCHAR(36)      NULL,
  `guestName`     VARCHAR(200)     NULL,
  `guestRoom`     VARCHAR(50)      NULL,
  `partySize`     INT              NULL,
  `subtotal`      DECIMAL(10, 2)   NOT NULL DEFAULT 0,
  `taxRate`       DECIMAL(5, 2)    NOT NULL DEFAULT 7,
  `taxAmount`     DECIMAL(10, 2)   NOT NULL DEFAULT 0,
  `serviceRate`   DECIMAL(5, 2)    NOT NULL DEFAULT 10,
  `serviceCharge` DECIMAL(10, 2)   NOT NULL DEFAULT 0,
  `discount`      DECIMAL(10, 2)   NOT NULL DEFAULT 0,
  `total`         DECIMAL(10, 2)   NOT NULL DEFAULT 0,
  `paymentStatus` VARCHAR(20)      NOT NULL DEFAULT 'UNPAID',
  `paymentMethod` VARCHAR(30)      NULL,
  `paidAmount`    DECIMAL(10, 2)   NULL,
  `changeAmount`  DECIMAL(10, 2)   NULL,
  `notes`         TEXT             NULL,
  `confirmedAt`   DATETIME(3)      NULL,
  `completedAt`   DATETIME(3)      NULL,
  `cancelledAt`   DATETIME(3)      NULL,
  `createdAt`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)      NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `orders_orderNumber_key` (`orderNumber`),
  INDEX `orders_tenantId_idx` (`tenantId`),
  INDEX `orders_restaurantId_idx` (`restaurantId`),
  INDEX `orders_tableId_idx` (`tableId`),
  INDEX `orders_status_idx` (`status`),
  INDEX `orders_paymentStatus_idx` (`paymentStatus`),
  CONSTRAINT `orders_restaurantId_fkey`
    FOREIGN KEY (`restaurantId`) REFERENCES `restaurants` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_tableId_fkey`
    FOREIGN KEY (`tableId`) REFERENCES `restaurant_tables` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── OrderItem ─────────────────────────────────────────────
CREATE TABLE `order_items` (
  `id`            VARCHAR(36)      NOT NULL,
  `tenantId`      VARCHAR(36)      NULL,
  `orderId`       VARCHAR(36)      NOT NULL,
  `menuItemId`    VARCHAR(36)      NOT NULL,
  `quantity`      INT              NOT NULL,
  `unitPrice`     DECIMAL(10, 2)   NOT NULL,
  `totalPrice`    DECIMAL(10, 2)   NOT NULL,
  `status`        VARCHAR(20)      NOT NULL DEFAULT 'PENDING',
  `notes`         VARCHAR(500)     NULL,
  `modifiers`     JSON             NULL,
  `sentToKitchen` BOOLEAN          NOT NULL DEFAULT FALSE,
  `sentAt`        DATETIME(3)      NULL,
  `preparedAt`    DATETIME(3)      NULL,
  `servedAt`      DATETIME(3)      NULL,
  `createdAt`     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`     DATETIME(3)      NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `order_items_orderId_idx` (`orderId`),
  INDEX `order_items_menuItemId_idx` (`menuItemId`),
  INDEX `order_items_status_idx` (`status`),
  CONSTRAINT `order_items_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `order_items_menuItemId_fkey`
    FOREIGN KEY (`menuItemId`) REFERENCES `menu_items` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── KitchenOrder ──────────────────────────────────────────
CREATE TABLE `kitchen_orders` (
  `id`          VARCHAR(36)  NOT NULL,
  `tenantId`    VARCHAR(36)  NULL,
  `orderId`     VARCHAR(36)  NOT NULL,
  `priority`    VARCHAR(10)  NOT NULL DEFAULT 'NORMAL',
  `status`      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  `stationName` VARCHAR(100) NULL,
  `notes`       TEXT         NULL,
  `startedAt`   DATETIME(3)  NULL,
  `completedAt` DATETIME(3)  NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  INDEX `kitchen_orders_tenantId_idx` (`tenantId`),
  INDEX `kitchen_orders_orderId_idx` (`orderId`),
  INDEX `kitchen_orders_status_idx` (`status`),
  INDEX `kitchen_orders_priority_idx` (`priority`),
  CONSTRAINT `kitchen_orders_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
