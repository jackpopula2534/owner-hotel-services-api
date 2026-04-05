-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'user',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `authProvider` VARCHAR(191) NOT NULL DEFAULT 'local',
    `employeeId` VARCHAR(191) NULL,
    `language` VARCHAR(191) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(191) NULL,
    `metadata` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `tenantId` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admins` (
    `id` VARCHAR(36) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'platform_admin',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastLoginAt` DATETIME(0) NULL,
    `lastLoginIp` VARCHAR(191) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_051db7d37d478a69a7432df147`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(36) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(36) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `adminId` VARCHAR(36) NULL,

    UNIQUE INDEX `refresh_tokens_token_key`(`token`),
    INDEX `refresh_tokens_token_idx`(`token`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_adminId_idx`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_resets` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `password_resets_token_key`(`token`),
    INDEX `password_resets_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `nationalId` VARCHAR(191) NULL,
    `passportNumber` VARCHAR(191) NULL,
    `dateOfBirth` VARCHAR(191) NULL,
    `nationality` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `isVip` BOOLEAN NOT NULL DEFAULT false,
    `vipLevel` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `guests_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `properties` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `serviceChargeEnabled` BOOLEAN NOT NULL DEFAULT true,
    `serviceChargePercent` DOUBLE NOT NULL DEFAULT 10,
    `vatEnabled` BOOLEAN NOT NULL DEFAULT true,
    `vatPercent` DOUBLE NOT NULL DEFAULT 7,
    `taxDisplayMode` VARCHAR(191) NOT NULL DEFAULT 'breakdown',
    `standardCheckInTime` VARCHAR(191) NOT NULL DEFAULT '14:00',
    `standardCheckOutTime` VARCHAR(191) NOT NULL DEFAULT '12:00',
    `cleaningBufferMinutes` INTEGER NOT NULL DEFAULT 60,
    `earlyCheckInEnabled` BOOLEAN NOT NULL DEFAULT false,
    `lateCheckOutEnabled` BOOLEAN NOT NULL DEFAULT false,
    `earlyCheckInFeeType` VARCHAR(191) NULL DEFAULT 'fixed',
    `earlyCheckInFeeAmount` DECIMAL(10, 2) NULL,
    `lateCheckOutFeeType` VARCHAR(191) NULL DEFAULT 'fixed',
    `lateCheckOutFeeAmount` DECIMAL(10, 2) NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Bangkok',

    INDEX `properties_tenantId_idx`(`tenantId`),
    INDEX `properties_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `properties_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `floor` INTEGER NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'available',
    `maxOccupancy` INTEGER NULL DEFAULT 2,
    `bedType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `amenities` JSON NULL,
    `extraBedAllowed` BOOLEAN NOT NULL DEFAULT false,
    `extraBedLimit` INTEGER NOT NULL DEFAULT 0,
    `extraBedPrice` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `description` VARCHAR(191) NULL,
    `images` JSON NULL,
    `weekendPrice` DECIMAL(10, 2) NULL,
    `holidayPriceEnabled` BOOLEAN NOT NULL DEFAULT false,
    `holidayPriceType` VARCHAR(191) NULL,
    `holidayPrice` DECIMAL(10, 2) NULL,
    `holidayPricePercent` DOUBLE NULL,
    `seasonalRates` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rooms_tenantId_idx`(`tenantId`),
    INDEX `rooms_propertyId_idx`(`propertyId`),
    UNIQUE INDEX `rooms_propertyId_number_key`(`propertyId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bookings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `guestId` VARCHAR(191) NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `guestFirstName` VARCHAR(191) NOT NULL,
    `guestLastName` VARCHAR(191) NOT NULL,
    `guestEmail` VARCHAR(191) NULL,
    `guestPhone` VARCHAR(191) NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `scheduledCheckIn` DATETIME(3) NULL,
    `scheduledCheckOut` DATETIME(3) NULL,
    `actualCheckIn` DATETIME(3) NULL,
    `actualCheckOut` DATETIME(3) NULL,
    `requestedEarlyCheckIn` BOOLEAN NULL DEFAULT false,
    `approvedEarlyCheckIn` BOOLEAN NULL DEFAULT false,
    `earlyCheckInFee` DECIMAL(10, 2) NULL,
    `requestedLateCheckOut` BOOLEAN NULL DEFAULT false,
    `approvedLateCheckOut` BOOLEAN NULL DEFAULT false,
    `lateCheckOutFee` DECIMAL(10, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `totalPrice` DECIMAL(10, 2) NOT NULL,
    `notes` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentStatus` VARCHAR(191) NULL DEFAULT 'pending',
    `amountPaid` DECIMAL(10, 2) NULL,
    `paymentNote` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `channelId` VARCHAR(191) NULL,

    INDEX `bookings_tenantId_idx`(`tenantId`),
    INDEX `bookings_propertyId_idx`(`propertyId`),
    INDEX `bookings_channelId_fkey`(`channelId`),
    INDEX `bookings_guestId_fkey`(`guestId`),
    INDEX `bookings_roomId_fkey`(`roomId`),
    INDEX `bookings_scheduledCheckIn_idx`(`scheduledCheckIn`),
    INDEX `bookings_scheduledCheckOut_idx`(`scheduledCheckOut`),
    INDEX `bookings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `rating` INTEGER NOT NULL,
    `comment` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reviews_bookingId_key`(`bookingId`),
    INDEX `reviews_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `restaurants` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `capacity` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `restaurants_code_key`(`code`),
    INDEX `restaurants_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `employeeCode` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `position` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_email_key`(`email`),
    UNIQUE INDEX `employees_employeeCode_key`(`employeeCode`),
    INDEX `employees_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channels` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `apiKey` VARCHAR(191) NULL,
    `apiSecret` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `syncEnabled` BOOLEAN NOT NULL DEFAULT false,
    `lastSyncAt` DATETIME(3) NULL,
    `settings` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `channels_code_key`(`code`),
    INDEX `channels_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_history` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `invoice_id` VARCHAR(191) NULL,
    `eventType` ENUM('created', 'renewed', 'upgraded', 'downgraded', 'cycle_changed', 'cancelled', 'reactivated', 'expired') NOT NULL,
    `description` TEXT NULL,
    `old_plan_id` VARCHAR(191) NULL,
    `new_plan_id` VARCHAR(191) NULL,
    `old_billing_cycle` VARCHAR(191) NULL,
    `new_billing_cycle` VARCHAR(191) NULL,
    `old_amount` DECIMAL(10, 2) NULL,
    `new_amount` DECIMAL(10, 2) NULL,
    `period_start` DATE NULL,
    `period_end` DATE NULL,
    `created_by` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_cf2c4c1d8fe13560a70057b4a0b`(`subscription_id`),
    INDEX `FK_d2fa43bf88ec3bced0c93c90036`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `features` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('toggle', 'limit', 'module') NOT NULL,
    `price_monthly` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `is_active` TINYINT NOT NULL DEFAULT 1,

    UNIQUE INDEX `IDX_c0e1f5d0ba8027c186705d752b`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_adjustments` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `type` ENUM('discount', 'credit', 'surcharge', 'proration', 'void', 'refund') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `original_amount` DECIMAL(10, 2) NOT NULL,
    `new_amount` DECIMAL(10, 2) NOT NULL,
    `reason` TEXT NULL,
    `notes` TEXT NULL,
    `adjustment_reference` VARCHAR(191) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_7404e72e5be63d0d41859bf4f1d`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_items` (
    `id` VARCHAR(36) NOT NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `type` ENUM('plan', 'feature', 'adjustment', 'room_charge', 'room_service', 'restaurant', 'minibar', 'laundry', 'other') NOT NULL,
    `ref_id` VARCHAR(191) NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `original_amount` DECIMAL(10, 2) NULL,
    `is_adjusted` TINYINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_dc991d555664682cfe892eea2c1`(`invoice_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NULL,
    `booking_id` VARCHAR(191) NULL,
    `invoice_no` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `original_amount` DECIMAL(10, 2) NULL,
    `adjusted_amount` DECIMAL(10, 2) NULL,
    `status` ENUM('draft', 'pending', 'paid', 'finalized', 'rejected', 'voided') NOT NULL DEFAULT 'pending',
    `due_date` DATE NOT NULL,
    `voided_at` TIMESTAMP(0) NULL,
    `voided_reason` TEXT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_37669c562a2525929927d9d691`(`invoice_no`),
    INDEX `FK_440f531f452dcc4389d201b9d4b`(`tenant_id`),
    INDEX `FK_5152c0aa0f851d9b95972b442e0`(`subscription_id`),
    INDEX `invoices_booking_id_idx`(`booking_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_refunds` (
    `id` VARCHAR(36) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `refund_no` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'completed') NOT NULL DEFAULT 'pending',
    `method` ENUM('original_method', 'bank_transfer', 'credit') NOT NULL DEFAULT 'original_method',
    `reason` TEXT NOT NULL,
    `notes` TEXT NULL,
    `bank_account` VARCHAR(191) NULL,
    `bank_name` VARCHAR(191) NULL,
    `account_holder` VARCHAR(191) NULL,
    `credit_id` VARCHAR(191) NULL,
    `processed_at` TIMESTAMP(0) NULL,
    `processed_by` VARCHAR(191) NULL,
    `rejected_reason` TEXT NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_35175cde68c765c82603c2ad4e`(`refund_no`),
    INDEX `FK_a10d6c1918989353b79932a2bad`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(36) NOT NULL,
    `payment_no` VARCHAR(191) NULL,
    `invoice_id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(36) NULL,
    `amount` DECIMAL(10, 2) NULL,
    `method` ENUM('transfer', 'qr', 'cash') NOT NULL,
    `slip_url` TEXT NULL,
    `status` ENUM('pending', 'approved', 'rejected', 'refunded', 'partially_refunded') NOT NULL DEFAULT 'pending',
    `refunded_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `approved_by` VARCHAR(191) NULL,
    `approved_at` TIMESTAMP(0) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_8aaa54db3d9827cba0999b7fb2`(`payment_no`),
    INDEX `FK_563a5e248518c623eebd987d43e`(`invoice_id`),
    INDEX `payments_tenant_id_idx`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_features` (
    `id` VARCHAR(36) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,

    INDEX `FK_27e866bdf4c6f2cf5854b7d0e57`(`feature_id`),
    INDEX `FK_b51952483b18fa15334d714a838`(`plan_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price_monthly` DECIMAL(10, 2) NOT NULL,
    `price_yearly` DECIMAL(10, 2) NULL,
    `yearly_discount_percent` INTEGER NOT NULL DEFAULT 0,
    `max_rooms` INTEGER NOT NULL,
    `max_users` INTEGER NOT NULL,
    `max_properties` INTEGER NOT NULL DEFAULT 1,
    `is_active` TINYINT NOT NULL DEFAULT 1,
    `description` TEXT NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `is_popular` TINYINT NOT NULL DEFAULT 0,
    `badge` TEXT NULL,
    `highlight_color` VARCHAR(50) NULL,
    `features` TEXT NULL,
    `button_text` VARCHAR(100) NULL DEFAULT 'เริ่มใช้งาน',
    `subtitle` VARCHAR(200) NULL,
    `target_audience` VARCHAR(200) NULL,
    `price_per_room` VARCHAR(50) NULL,

    UNIQUE INDEX `IDX_95f7ef3fc4c31a3545b4d825dd`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_feature_logs` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_feature_id` VARCHAR(191) NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,
    `feature_name` VARCHAR(191) NOT NULL,
    `action` ENUM('added', 'updated', 'removed') NOT NULL,
    `old_price` DECIMAL(10, 2) NULL,
    `new_price` DECIMAL(10, 2) NULL,
    `old_quantity` INTEGER NULL,
    `new_quantity` INTEGER NULL,
    `prorated_amount` DECIMAL(10, 2) NULL,
    `credit_amount` DECIMAL(10, 2) NULL,
    `reason` TEXT NULL,
    `effective_date` DATE NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_490409e983f4d310ad3da4d8470`(`subscription_feature_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_features` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `feature_id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NULL DEFAULT 1,
    `price` DECIMAL(10, 2) NOT NULL,
    `is_active` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_2fecc17c6205a70dea764511dc5`(`feature_id`),
    INDEX `FK_ea26424925db0d7a2429a8b948e`(`subscription_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(36) NOT NULL,
    `subscription_code` VARCHAR(191) NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `previous_plan_id` VARCHAR(191) NULL,
    `status` ENUM('trial', 'pending', 'active', 'expired', 'cancelled') NOT NULL DEFAULT 'trial',
    `billing_cycle` ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `next_billing_date` DATE NULL,
    `billing_anchor_date` DATE NULL,
    `auto_renew` TINYINT NOT NULL DEFAULT 1,
    `cancelled_at` TIMESTAMP(0) NULL,
    `cancellation_reason` TEXT NULL,
    `renewed_count` INTEGER NOT NULL DEFAULT 0,
    `last_renewed_at` TIMESTAMP(0) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_616df085ddc496ef3609383682`(`subscription_code`),
    INDEX `FK_dfc0332dc3b8edf0e5b0e4d503f`(`previous_plan_id`),
    INDEX `FK_e45fca5d912c3a2fab512ac25dc`(`plan_id`),
    INDEX `FK_f6ac03431c311ccb8bbd7d3af18`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_credits` (
    `id` VARCHAR(36) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `type` ENUM('manual', 'refund', 'proration', 'promotion', 'cancellation') NOT NULL DEFAULT 'manual',
    `status` ENUM('available', 'used', 'expired', 'cancelled') NOT NULL DEFAULT 'available',
    `original_amount` DECIMAL(10, 2) NOT NULL,
    `remaining_amount` DECIMAL(10, 2) NOT NULL,
    `description` TEXT NULL,
    `reference_type` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `expires_at` TIMESTAMP(0) NULL,
    `used_at` TIMESTAMP(0) NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `FK_1c75d0789feee398e6cd35df720`(`tenant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_tenants` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `user_tenants_userId_idx`(`userId`),
    INDEX `user_tenants_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `user_tenants_userId_tenantId_key`(`userId`, `tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenants` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `room_count` INTEGER NOT NULL DEFAULT 0,
    `name_en` VARCHAR(191) NULL,
    `property_type` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `customer_name` VARCHAR(191) NULL,
    `tax_id` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `district` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `postal_code` VARCHAR(191) NULL,
    `status` ENUM('trial', 'active', 'suspended', 'expired') NOT NULL DEFAULT 'trial',
    `trial_ends_at` TIMESTAMP(0) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'info',
    `category` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `notifications_userId_idx`(`userId`),
    INDEX `notifications_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analytics_events` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `eventName` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `analytics_events_userId_idx`(`userId`),
    INDEX `analytics_events_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `rules` JSON NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `feature_flags_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_demos` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `demoDate` DATETIME(3) NOT NULL,
    `demoType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `notes` TEXT NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_messages` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'unread',
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_steps` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `stepKey` VARCHAR(191) NOT NULL,
    `isCompleted` BOOLEAN NOT NULL DEFAULT false,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `onboarding_steps_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `onboarding_steps_tenantId_stepKey_key`(`tenantId`, `stepKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loyalty_points` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `guestId` VARCHAR(191) NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `tier` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `loyalty_points_tenantId_idx`(`tenantId`),
    INDEX `loyalty_points_guestId_idx`(`guestId`),
    UNIQUE INDEX `loyalty_points_tenantId_guestId_key`(`tenantId`, `guestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `referrals` (
    `id` VARCHAR(191) NOT NULL,
    `referrerId` VARCHAR(191) NULL,
    `tenantId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `rewardPoints` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `referrals_referrerId_idx`(`referrerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promotions` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `targetSegment` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DECIMAL(10, 2) NOT NULL,
    `minPurchase` DECIMAL(10, 2) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `coupons_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'queued', 'sent', 'delivered', 'opened', 'bounced', 'failed') NOT NULL DEFAULT 'pending',
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `openedAt` DATETIME(3) NULL,
    `bouncedAt` DATETIME(3) NULL,
    `errorMsg` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `email_logs_tenantId_idx`(`tenantId`),
    INDEX `email_logs_recipient_idx`(`recipient`),
    INDEX `email_logs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `guestId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `bookingConfirmation` BOOLEAN NOT NULL DEFAULT true,
    `checkInReminder` BOOLEAN NOT NULL DEFAULT true,
    `checkOutReminder` BOOLEAN NOT NULL DEFAULT true,
    `paymentReceipt` BOOLEAN NOT NULL DEFAULT true,
    `promotionalEmails` BOOLEAN NOT NULL DEFAULT false,
    `newsletter` BOOLEAN NOT NULL DEFAULT false,
    `unsubscribedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `email_preferences_tenantId_idx`(`tenantId`),
    INDEX `email_preferences_guestId_idx`(`guestId`),
    UNIQUE INDEX `email_preferences_email_tenantId_key`(`email`, `tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `adminId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `resourceId` VARCHAR(191) NULL,
    `oldValues` JSON NULL,
    `newValues` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `audit_logs_tenantId_idx`(`tenantId`),
    INDEX `audit_logs_userId_idx`(`userId`),
    INDEX `audit_logs_adminId_idx`(`adminId`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_resource_idx`(`resource`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_2fa_settings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `backupCodes` JSON NULL,
    `enabledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `user_2fa_settings_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promptpay_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `invoiceId` VARCHAR(191) NULL,
    `paymentId` VARCHAR(191) NULL,
    `transactionRef` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `promptpayId` VARCHAR(191) NOT NULL,
    `qrCodeData` TEXT NOT NULL,
    `status` ENUM('pending', 'paid', 'verified', 'expired', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verificationRef` VARCHAR(191) NULL,
    `webhookData` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `promptpay_transactions_transactionRef_key`(`transactionRef`),
    INDEX `promptpay_transactions_tenantId_idx`(`tenantId`),
    INDEX `promptpay_transactions_bookingId_idx`(`bookingId`),
    INDEX `promptpay_transactions_invoiceId_idx`(`invoiceId`),
    INDEX `promptpay_transactions_transactionRef_idx`(`transactionRef`),
    INDEX `promptpay_transactions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `line_notify_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `accessToken` TEXT NOT NULL,
    `targetName` VARCHAR(191) NULL,
    `targetType` VARCHAR(191) NULL,
    `enabledEvents` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `line_notify_tokens_tenantId_idx`(`tenantId`),
    INDEX `line_notify_tokens_userId_idx`(`userId`),
    UNIQUE INDEX `line_notify_tokens_tenantId_userId_key`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_notification_devices` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `deviceToken` VARCHAR(512) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `deviceModel` VARCHAR(191) NULL,
    `osVersion` VARCHAR(191) NULL,
    `appVersion` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastActiveAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `push_notification_devices_userId_idx`(`userId`),
    INDEX `push_notification_devices_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `push_notification_devices_userId_deviceToken_key`(`userId`, `deviceToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bookingNotifications` BOOLEAN NOT NULL DEFAULT true,
    `paymentNotifications` BOOLEAN NOT NULL DEFAULT true,
    `reminderNotifications` BOOLEAN NOT NULL DEFAULT true,
    `promotionalNotifications` BOOLEAN NOT NULL DEFAULT false,
    `systemNotifications` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `push_notification_preferences_userId_key`(`userId`),
    INDEX `push_notification_preferences_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_notification_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `data` JSON NULL,
    `sentAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `readAt` DATETIME(3) NULL,

    INDEX `push_notification_logs_userId_idx`(`userId`),
    INDEX `push_notification_logs_sentAt_idx`(`sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NULL,
    `employeeCode` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `shiftType` VARCHAR(191) NULL,
    `maxTasksPerShift` INTEGER NULL DEFAULT 8,
    `specializations` TEXT NULL,
    `rating` DECIMAL(3, 2) NULL,
    `efficiency` INTEGER NULL DEFAULT 100,
    `employeeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_employeeId_key`(`employeeId`),
    INDEX `staff_tenantId_idx`(`tenantId`),
    INDEX `staff_status_idx`(`status`),
    INDEX `staff_department_idx`(`department`),
    INDEX `staff_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenance_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `assignedToId` VARCHAR(191) NULL,
    `requestedDate` DATETIME(3) NULL,
    `scheduledDate` DATETIME(3) NULL,
    `estimatedDuration` INTEGER NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `actualDuration` INTEGER NULL,
    `estimatedCost` DECIMAL(10, 2) NULL,
    `actualCost` DECIMAL(10, 2) NULL,
    `partsUsed` TEXT NULL,
    `inspectedById` VARCHAR(191) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `rating` INTEGER NULL,
    `inspectionNotes` TEXT NULL,
    `notes` TEXT NULL,
    `attachments` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `maintenance_tasks_tenantId_idx`(`tenantId`),
    INDEX `maintenance_tasks_propertyId_idx`(`propertyId`),
    INDEX `maintenance_tasks_roomId_idx`(`roomId`),
    INDEX `maintenance_tasks_status_idx`(`status`),
    INDEX `maintenance_tasks_category_idx`(`category`),
    INDEX `maintenance_tasks_assignedToId_idx`(`assignedToId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_add_ons` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unitPrice` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `booking_add_ons_bookingId_idx`(`bookingId`),
    INDEX `booking_add_ons_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `housekeeping_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'daily',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `scheduledFor` DATETIME(3) NULL,
    `estimatedDuration` INTEGER NOT NULL DEFAULT 30,
    `actualStartTime` DATETIME(3) NULL,
    `actualEndTime` DATETIME(3) NULL,
    `actualDuration` INTEGER NULL,
    `startTime` DATETIME(3) NULL,
    `endTime` DATETIME(3) NULL,
    `roomReadyAt` DATETIME(3) NULL,
    `assignedToId` VARCHAR(191) NULL,
    `assignedToName` VARCHAR(191) NULL,
    `completionPercentage` INTEGER NULL,
    `inspectedById` VARCHAR(191) NULL,
    `inspectedByName` VARCHAR(191) NULL,
    `inspectedAt` DATETIME(3) NULL,
    `rating` INTEGER NULL,
    `inspectionNotes` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX `housekeeping_tasks_roomId_idx`(`roomId`),
    INDEX `housekeeping_tasks_bookingId_idx`(`bookingId`),
    INDEX `housekeeping_tasks_tenantId_idx`(`tenantId`),
    INDEX `housekeeping_tasks_status_idx`(`status`),
    INDEX `housekeeping_tasks_type_idx`(`type`),
    INDEX `housekeeping_tasks_assignedToId_idx`(`assignedToId`),
    INDEX `housekeeping_tasks_scheduledFor_idx`(`scheduledFor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `billing_history` ADD CONSTRAINT `FK_cf2c4c1d8fe13560a70057b4a0b` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `billing_history` ADD CONSTRAINT `FK_d2fa43bf88ec3bced0c93c90036` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoice_adjustments` ADD CONSTRAINT `FK_7404e72e5be63d0d41859bf4f1d` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoice_items` ADD CONSTRAINT `FK_dc991d555664682cfe892eea2c1` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `FK_440f531f452dcc4389d201b9d4b` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `FK_5152c0aa0f851d9b95972b442e0` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payment_refunds` ADD CONSTRAINT `FK_a10d6c1918989353b79932a2bad` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `FK_563a5e248518c623eebd987d43e` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `FK_27e866bdf4c6f2cf5854b7d0e57` FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `plan_features` ADD CONSTRAINT `FK_b51952483b18fa15334d714a838` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscription_feature_logs` ADD CONSTRAINT `FK_490409e983f4d310ad3da4d8470` FOREIGN KEY (`subscription_feature_id`) REFERENCES `subscription_features`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscription_features` ADD CONSTRAINT `FK_2fecc17c6205a70dea764511dc5` FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscription_features` ADD CONSTRAINT `FK_ea26424925db0d7a2429a8b948e` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `FK_dfc0332dc3b8edf0e5b0e4d503f` FOREIGN KEY (`previous_plan_id`) REFERENCES `plans`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `FK_e45fca5d912c3a2fab512ac25dc` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `FK_f6ac03431c311ccb8bbd7d3af18` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `tenant_credits` ADD CONSTRAINT `FK_1c75d0789feee398e6cd35df720` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `user_tenants` ADD CONSTRAINT `user_tenants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_tenants` ADD CONSTRAINT `user_tenants_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff` ADD CONSTRAINT `staff_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_tasks` ADD CONSTRAINT `maintenance_tasks_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_tasks` ADD CONSTRAINT `maintenance_tasks_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_tasks` ADD CONSTRAINT `maintenance_tasks_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_tasks` ADD CONSTRAINT `maintenance_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_add_ons` ADD CONSTRAINT `booking_add_ons_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `housekeeping_tasks` ADD CONSTRAINT `housekeeping_tasks_inspectedById_fkey` FOREIGN KEY (`inspectedById`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
