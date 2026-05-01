-- CreateTable: add_ons (catalog ของ Add-on ที่ระบบมีให้ subscription)
CREATE TABLE `add_ons` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(80) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `price` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `billing_cycle` ENUM('monthly', 'yearly', 'one_time') NOT NULL DEFAULT 'monthly',
    `category` VARCHAR(80) NULL,
    `icon` VARCHAR(80) NULL,
    `display_order` INT NOT NULL DEFAULT 0,
    `min_quantity` INT NOT NULL DEFAULT 1,
    `max_quantity` INT NOT NULL DEFAULT 1,
    `is_active` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_add_ons_code`(`code`),
    INDEX `IDX_add_ons_is_active`(`is_active`),
    INDEX `IDX_add_ons_category`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed: 2 add-ons เริ่มต้นที่หน้า Subscription แสดงไว้เป็น hardcode
INSERT INTO `add_ons` (`id`, `code`, `name`, `description`, `price`, `billing_cycle`, `category`, `icon`, `display_order`, `min_quantity`, `max_quantity`, `is_active`)
VALUES
    (UUID(), 'BASIC_REPORT', 'Basic Report', 'รายงานพื้นฐานสำหรับติดตามยอดและการจอง', 0.00, 'monthly', 'reports', 'bar-chart', 1, 1, 1, 1),
    (UUID(), 'HOUSEKEEPING_MANAGEMENT', 'Housekeeping Management', 'จัดการงานแม่บ้าน, มอบหมายงาน, ติดตามสถานะห้อง', 500.00, 'monthly', 'operations', 'sparkles', 2, 1, 1, 1);
