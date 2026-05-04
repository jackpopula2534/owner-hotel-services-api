-- DropForeignKey
ALTER TABLE `announcement_reads` DROP FOREIGN KEY `FK_announcement_reads_ann`;

-- DropForeignKey
ALTER TABLE `api_keys` DROP FOREIGN KEY `FK_api_keys_tenant`;

-- DropForeignKey
ALTER TABLE `data_export_requests` DROP FOREIGN KEY `FK_data_export_tenant`;

-- DropForeignKey
ALTER TABLE `dunning_attempts` DROP FOREIGN KEY `FK_dunning_invoice`;

-- DropForeignKey
ALTER TABLE `dunning_attempts` DROP FOREIGN KEY `FK_dunning_tenant`;

-- DropForeignKey
ALTER TABLE `incident_updates` DROP FOREIGN KEY `FK_incident_updates_incident`;

-- DropForeignKey
ALTER TABLE `subscription_coupon_redemptions` DROP FOREIGN KEY `FK_sub_coupon_redemptions_coupon`;

-- DropForeignKey
ALTER TABLE `subscription_coupon_redemptions` DROP FOREIGN KEY `FK_sub_coupon_redemptions_tenant`;

-- DropForeignKey
ALTER TABLE `tenant_brandings` DROP FOREIGN KEY `FK_tenant_brandings_tenant`;

-- DropForeignKey
ALTER TABLE `usage_counters` DROP FOREIGN KEY `FK_usage_counter_tenant`;

-- DropForeignKey
ALTER TABLE `usage_overage_charges` DROP FOREIGN KEY `FK_overage_tenant`;

-- DropIndex
DROP INDEX `users_expiresAt_idx` ON `users`;

-- DropIndex
DROP INDEX `users_status_expiresAt_idx` ON `users`;

-- AlterTable
ALTER TABLE `menu_categories` MODIFY `icon` VARCHAR(191) NULL,
    MODIFY `color` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `suppliers` MODIFY `emoji` VARCHAR(191) NULL DEFAULT '🏢';

-- AddForeignKey
ALTER TABLE `subscription_coupon_redemptions` ADD CONSTRAINT `subscription_coupon_redemptions_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `subscription_coupons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incident_updates` ADD CONSTRAINT `incident_updates_incident_id_fkey` FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `announcement_reads` ADD CONSTRAINT `announcement_reads_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
