-- NOTE: 2 บรรทัด `DROP INDEX users_expiresAt_idx` / `users_status_expiresAt_idx`
-- ที่เคยอยู่ในไฟล์นี้ถูกลบออก เพราะ:
--   * เป็น index ของ feature User Lifecycle Management
--   * ใน DB ยังไม่มี index ทั้ง 2 ตัวนั้น (เพิ่งจะถูก CREATE ใน migration
--     `20260501000000_add_user_lifecycle_fields`) — DROP ก่อน CREATE จึงผิดลำดับ
--   * เกิดจาก auto-diff ของ `prisma migrate dev` ที่ snapshot ตอน schema มี index
--     แต่ DB ยังไม่มี — ปลอดภัยที่จะตัด DROP ทั้ง 2 บรรทัดทิ้งทั้งหมด

-- AlterTable
ALTER TABLE `suppliers` MODIFY `emoji` VARCHAR(191) NULL DEFAULT '🏢';

-- AddForeignKey
ALTER TABLE `qc_records` ADD CONSTRAINT `qc_records_goodsReceiveId_fkey` FOREIGN KEY (`goodsReceiveId`) REFERENCES `goods_receives`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
