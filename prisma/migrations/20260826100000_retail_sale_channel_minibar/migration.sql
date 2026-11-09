-- ช่องทางการขาย: หน้าร้าน vs มินิบาร์ในห้องพัก
-- ของเดิมทั้งหมดคือการขายหน้าร้าน จึงตกเป็น SHOP โดยปริยาย
ALTER TABLE `retail_sales`
  ADD COLUMN `channel` ENUM('SHOP', 'MINIBAR') NOT NULL DEFAULT 'SHOP',
  ADD COLUMN `roomId` VARCHAR(191) NULL;

CREATE INDEX `retail_sales_channel_idx` ON `retail_sales`(`channel`);
CREATE INDEX `retail_sales_roomId_idx` ON `retail_sales`(`roomId`);
