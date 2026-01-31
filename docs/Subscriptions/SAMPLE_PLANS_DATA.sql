-- Sample Plans Data for Sales Page
-- Run this SQL script to insert sample data for 3 subscription plans

-- Clear existing plans (optional - comment out if you want to keep existing data)
-- DELETE FROM plans WHERE code IN ('S', 'M', 'L');

-- Insert Starter Plan
INSERT INTO plans (
  id,
  code,
  name,
  price_monthly,
  max_rooms,
  max_users,
  is_active,
  description,
  display_order,
  is_popular,
  badge,
  highlight_color,
  features,
  button_text
) VALUES (
  UUID(),
  'S',
  'Starter',
  1990.00,
  20,
  3,
  1,
  'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
  1,
  0,
  NULL,
  NULL,
  '["รองรับ 20 ห้อง", "ผู้ใช้งาน 3 คน", "ระบบจองครบครัน"]',
  'เริ่มใช้งาน'
);

-- Insert Professional Plan (Popular)
INSERT INTO plans (
  id,
  code,
  name,
  price_monthly,
  max_rooms,
  max_users,
  is_active,
  description,
  display_order,
  is_popular,
  badge,
  highlight_color,
  features,
  button_text
) VALUES (
  UUID(),
  'M',
  'Professional',
  4990.00,
  50,
  10,
  1,
  'เหมาะสำหรับโรงแรมขนาดกลาง พร้อมฟีเจอร์ครบครัน',
  2,
  1,
  'ยอดนิยม',
  '#8B5CF6',
  '["รองรับ 50 ห้อง", "ผู้ใช้งาน 10 คน", "ระบบจองครบครัน", "รายงานขั้นสูง", "การจัดการหลายสาขา"]',
  'เริ่มใช้งาน'
);

-- Insert Enterprise Plan
INSERT INTO plans (
  id,
  code,
  name,
  price_monthly,
  max_rooms,
  max_users,
  is_active,
  description,
  display_order,
  is_popular,
  badge,
  highlight_color,
  features,
  button_text
) VALUES (
  UUID(),
  'L',
  'Enterprise',
  9990.00,
  200,
  50,
  1,
  'สำหรับองค์กรขนาดใหญ่ พร้อม dedicated support',
  3,
  0,
  NULL,
  NULL,
  '["รองรับ 200 ห้อง", "ผู้ใช้งาน 50 คน", "ระบบจองครบครัน", "รายงานขั้นสูง", "การจัดการหลายสาขา", "API Integration", "Dedicated Support"]',
  'ติดต่อฝ่ายขาย'
);

-- Verify the data
SELECT
  code,
  name,
  price_monthly,
  max_rooms,
  max_users,
  display_order,
  is_popular,
  badge
FROM plans
ORDER BY display_order;
