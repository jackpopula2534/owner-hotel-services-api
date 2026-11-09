-- ใบลดหนี้ตัดยอดใบแจ้งหนี้ต้นทาง + ภาษีถูกหัก ณ ที่จ่ายตอนรับชำระ
ALTER TABLE `ar_invoices`
  ADD COLUMN `creditedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `refInvoiceId` VARCHAR(191) NULL;
CREATE INDEX `ar_invoices_refInvoiceId_idx` ON `ar_invoices`(`refInvoiceId`);

ALTER TABLE `ar_receipts`
  ADD COLUMN `whtAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `whtCertNo` VARCHAR(50) NULL,
  ADD COLUMN `whtCertDate` DATE NULL;

-- บัญชี 1109 ภาษีถูกหัก ณ ที่จ่าย ให้ tenant เดิมที่มีผังบัญชีแล้ว (ensureDefault ข้าม tenant ที่มีบัญชี)
INSERT INTO `account_charts` (`id`, `tenantId`, `code`, `name`, `nameEn`, `type`, `normalBalance`, `level`, `parentId`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT UUID(), a.`tenantId`, '1109', 'ภาษีถูกหัก ณ ที่จ่าย', 'Withholding Tax Receivable', 'ASSET', 'DEBIT', 'ACCOUNT', a.`parentId`, 1, a.`sortOrder` + 8, NOW(3), NOW(3)
FROM `account_charts` a
WHERE a.`code` = '1101'
  AND NOT EXISTS (SELECT 1 FROM `account_charts` b WHERE b.`tenantId` = a.`tenantId` AND b.`code` = '1109');
