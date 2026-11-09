-- เว็บไซต์จองลาน (WEBSITE_BUILDER) อยู่ในแพ็ก Camp Plus + แพ็กทดลองใช้ลาน
-- Camp Plus ฿999 → ฿1,290/เดือน (ทดลองใช้: ออกแบบ/ดูตัวอย่างได้ เผยแพร่ได้หลังชำระเงิน)

UPDATE `plans`
SET `price_monthly` = 1290,
    `price_yearly` = IF(`price_yearly` IS NULL, NULL, 13158),
    `description` = 'ลานกางเต็นท์ที่ต้องการระบบหลังบ้านครบ + เว็บไซต์ให้ลูกค้าจองลานเอง'
WHERE `code` = 'CAMP_PLUS';

INSERT IGNORE INTO `plan_addons` (`id`, `plan_id`, `addon_id`)
SELECT UUID(), p.`id`, a.`id`
FROM `plans` p
JOIN `add_ons` a ON a.`code` = 'WEBSITE_BUILDER'
WHERE p.`code` IN ('CAMP_PLUS', 'CAMP_FREE');
