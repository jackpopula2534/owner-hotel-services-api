-- เทมเพลตรุ่นแรก (split/editorial/resort) ถูกแทนที่ด้วยดีไซน์ใหม่ nature/luxe/playful
UPDATE `website_sites` SET `templateKey` = CASE `templateKey` WHEN 'split' THEN 'nature' WHEN 'editorial' THEN 'luxe' WHEN 'resort' THEN 'playful' ELSE `templateKey` END
WHERE `templateKey` IN ('split', 'editorial', 'resort');
UPDATE `website_sites` SET `publishedTemplateKey` = CASE `publishedTemplateKey` WHEN 'split' THEN 'nature' WHEN 'editorial' THEN 'luxe' WHEN 'resort' THEN 'playful' ELSE `publishedTemplateKey` END
WHERE `publishedTemplateKey` IN ('split', 'editorial', 'resort');
