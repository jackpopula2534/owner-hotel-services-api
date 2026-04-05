-- Add property add-on feature to features table
INSERT INTO `features` (`id`, `code`, `name`, `description`, `type`, `price_monthly`, `is_active`)
VALUES (
    UUID(),
    'additional_properties',
    'เพิ่มสาขา/โรงแรม',
    'เพิ่มจำนวนสาขา/โรงแรมที่สามารถจัดการได้ในระบบ (1 สาขาต่อ 1 หน่วย)',
    'limit',
    500.00,
    1
);
