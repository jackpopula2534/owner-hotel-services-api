-- เทมเพลตเลย์เอาต์ของเว็บ: snapshot ตอนเผยแพร่ เพื่อให้เปลี่ยนเทมเพลตในร่างได้โดยไม่กระทบเว็บจริง
ALTER TABLE `website_sites` ADD COLUMN `publishedTemplateKey` VARCHAR(30) NULL;

-- เว็บที่เผยแพร่อยู่แล้ว: ถือว่าเลย์เอาต์ปัจจุบันคือฉบับเผยแพร่
UPDATE `website_sites` SET `publishedTemplateKey` = `templateKey` WHERE `publishedContent` IS NOT NULL;
