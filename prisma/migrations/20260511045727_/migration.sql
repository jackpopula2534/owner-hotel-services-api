/*
  Warnings:

  - The values [room_charge,room_service,restaurant,minibar,laundry,other] on the enum `invoice_items_type` will be removed. If these variants are still used in the database, this will fail.
  - You are about to alter the column `booking_id` on the `invoices` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(36)`.

*/
-- DropForeignKey
ALTER TABLE `billing_history` DROP FOREIGN KEY `FK_cf2c4c1d8fe13560a70057b4a0b`;

-- DropForeignKey
ALTER TABLE `billing_history` DROP FOREIGN KEY `FK_d2fa43bf88ec3bced0c93c90036`;

-- DropForeignKey
ALTER TABLE `invoice_adjustments` DROP FOREIGN KEY `FK_7404e72e5be63d0d41859bf4f1d`;

-- DropForeignKey
ALTER TABLE `invoice_items` DROP FOREIGN KEY `FK_dc991d555664682cfe892eea2c1`;

-- DropForeignKey
ALTER TABLE `invoices` DROP FOREIGN KEY `FK_440f531f452dcc4389d201b9d4b`;

-- DropForeignKey
ALTER TABLE `invoices` DROP FOREIGN KEY `FK_5152c0aa0f851d9b95972b442e0`;

-- DropForeignKey
ALTER TABLE `payment_refunds` DROP FOREIGN KEY `FK_a10d6c1918989353b79932a2bad`;

-- DropForeignKey
ALTER TABLE `payments` DROP FOREIGN KEY `FK_563a5e248518c623eebd987d43e`;

-- DropForeignKey
ALTER TABLE `payments` DROP FOREIGN KEY `payments_tenant_id_fkey`;

-- DropForeignKey
ALTER TABLE `plan_features` DROP FOREIGN KEY `FK_27e866bdf4c6f2cf5854b7d0e57`;

-- DropForeignKey
ALTER TABLE `plan_features` DROP FOREIGN KEY `FK_b51952483b18fa15334d714a838`;

-- DropForeignKey
ALTER TABLE `subscription_feature_logs` DROP FOREIGN KEY `FK_490409e983f4d310ad3da4d8470`;

-- DropForeignKey
ALTER TABLE `subscription_features` DROP FOREIGN KEY `FK_2fecc17c6205a70dea764511dc5`;

-- DropForeignKey
ALTER TABLE `subscription_features` DROP FOREIGN KEY `FK_ea26424925db0d7a2429a8b948e`;

-- DropForeignKey
ALTER TABLE `subscriptions` DROP FOREIGN KEY `FK_dfc0332dc3b8edf0e5b0e4d503f`;

-- DropForeignKey
ALTER TABLE `subscriptions` DROP FOREIGN KEY `FK_e45fca5d912c3a2fab512ac25dc`;

-- DropForeignKey
ALTER TABLE `subscriptions` DROP FOREIGN KEY `FK_f6ac03431c311ccb8bbd7d3af18`;

-- DropForeignKey
ALTER TABLE `tenant_credits` DROP FOREIGN KEY `FK_1c75d0789feee398e6cd35df720`;

-- DropIndex
DROP INDEX `IDX_features_is_active` ON `features`;

-- AlterTable
ALTER TABLE `billing_history` MODIFY `subscription_id` VARCHAR(255) NOT NULL,
    MODIFY `invoice_id` VARCHAR(255) NULL,
    MODIFY `old_plan_id` VARCHAR(255) NULL,
    MODIFY `new_plan_id` VARCHAR(255) NULL,
    MODIFY `old_billing_cycle` VARCHAR(255) NULL,
    MODIFY `new_billing_cycle` VARCHAR(255) NULL,
    MODIFY `created_by` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `features` MODIFY `code` VARCHAR(255) NOT NULL,
    MODIFY `name` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `invoice_adjustments` MODIFY `invoice_id` VARCHAR(255) NOT NULL,
    MODIFY `adjustment_reference` VARCHAR(255) NULL,
    MODIFY `created_by` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `invoice_items` MODIFY `invoice_id` VARCHAR(255) NOT NULL,
    MODIFY `type` ENUM('plan', 'feature', 'adjustment') NOT NULL,
    MODIFY `ref_id` VARCHAR(255) NULL,
    MODIFY `description` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `invoices` MODIFY `tenant_id` VARCHAR(255) NOT NULL,
    MODIFY `subscription_id` VARCHAR(255) NULL,
    MODIFY `booking_id` VARCHAR(36) NULL,
    MODIFY `invoice_no` VARCHAR(255) NOT NULL,
    MODIFY `status` ENUM('pending', 'draft', 'finalized', 'paid', 'rejected', 'voided') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `payment_refunds` MODIFY `payment_id` VARCHAR(255) NOT NULL,
    MODIFY `refund_no` VARCHAR(255) NOT NULL,
    MODIFY `bank_account` VARCHAR(255) NULL,
    MODIFY `bank_name` VARCHAR(255) NULL,
    MODIFY `account_holder` VARCHAR(255) NULL,
    MODIFY `credit_id` VARCHAR(255) NULL,
    MODIFY `processed_by` VARCHAR(255) NULL,
    MODIFY `created_by` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `payments` MODIFY `payment_no` VARCHAR(255) NULL,
    MODIFY `invoice_id` VARCHAR(255) NOT NULL,
    MODIFY `tenant_id` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `plan_features` MODIFY `plan_id` VARCHAR(255) NOT NULL,
    MODIFY `feature_id` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `plans` MODIFY `code` VARCHAR(255) NOT NULL,
    MODIFY `name` VARCHAR(255) NOT NULL,
    MODIFY `subtitle` VARCHAR(255) NULL,
    MODIFY `target_audience` VARCHAR(255) NULL,
    MODIFY `price_per_room` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `subscription_feature_logs` MODIFY `subscription_feature_id` VARCHAR(255) NULL,
    MODIFY `subscription_id` VARCHAR(255) NOT NULL,
    MODIFY `feature_id` VARCHAR(255) NOT NULL,
    MODIFY `feature_name` VARCHAR(255) NOT NULL,
    MODIFY `created_by` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `subscription_features` MODIFY `subscription_id` VARCHAR(255) NOT NULL,
    MODIFY `feature_id` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `subscriptions` MODIFY `subscription_code` VARCHAR(255) NULL,
    MODIFY `tenant_id` VARCHAR(255) NOT NULL,
    MODIFY `plan_id` VARCHAR(255) NOT NULL,
    MODIFY `previous_plan_id` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `tenant_credits` MODIFY `tenant_id` VARCHAR(255) NOT NULL,
    MODIFY `reference_type` VARCHAR(255) NULL,
    MODIFY `reference_id` VARCHAR(255) NULL,
    MODIFY `created_by` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `tenants` MODIFY `name` VARCHAR(255) NOT NULL,
    MODIFY `name_en` VARCHAR(255) NULL,
    MODIFY `property_type` VARCHAR(255) NULL,
    MODIFY `location` VARCHAR(255) NULL,
    MODIFY `website` VARCHAR(255) NULL,
    MODIFY `customer_name` VARCHAR(255) NULL,
    MODIFY `tax_id` VARCHAR(255) NULL,
    MODIFY `email` VARCHAR(255) NULL,
    MODIFY `phone` VARCHAR(255) NULL,
    MODIFY `district` VARCHAR(255) NULL,
    MODIFY `province` VARCHAR(255) NULL,
    MODIFY `postal_code` VARCHAR(255) NULL;

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
