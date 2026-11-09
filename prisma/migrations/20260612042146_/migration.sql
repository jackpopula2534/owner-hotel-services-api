-- AddForeignKey
ALTER TABLE `crm_contacts` ADD CONSTRAINT `crm_contacts_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
