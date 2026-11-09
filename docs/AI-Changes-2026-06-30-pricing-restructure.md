# 2026-06-30 — ปรับโครงสร้างการขายใหม่ (Seeder)

> หมายเหตุ: Obsidian vault `hotel-services-master` ไม่ได้เชื่อมในเซสชันนี้ — กรุณา copy ไฟล์นี้ไปที่ `Logs/AI-Changes/` ของ vault และอัปเดต `Index.md`

- **AI Agent:** Claude
- **Project:** owner-hotel-services-api (Backend)

## Changes Made
- แยกการขายเป็น 2 ระบบ: **โรงแรม (HOTEL)** + **ลานกางเต็นท์ (CAMP)** ผ่าน column `system` ใหม่ใน `plans` และ `add_ons`
- เพิ่ม 2 plan ลาน: `CAMP_FREE` (ทดลอง 15 วัน) และ `CAMP` (฿199 ราคาเดียว)
- เปลี่ยน trial โรงแรมจาก 14 → **15 วัน** (copy + badge)
- Add-on เหลือ **7 module** (จากเดิม 15): Restaurant, Housekeeping, Maintenance, Inventory, HR, CRM, Accounting
- เลิกขาย 8 ตัว (deactivate): OTA_INTEGRATION, CHANNEL_MANAGER, EXTRA_ANALYTICS, AUTOMATION_MODULE, CUSTOM_BRANDING (placeholder/ไม่พร้อม) + POS→Restaurant, LOYALTY→CRM, COST_ACCOUNTING(USALI)→Accounting (ยุบเป็น feature)
- เพิ่ม Feature ใหม่ `messaging_inbox` (แชทรวม FB/LINE) ฿390 ขายแยก ไม่รวมในแพ็ก
- เพิ่ม `CHILD_ADDON_GRANTS` ใน `addon.service` — ซื้อ parent module ได้สิทธิ์ child code อัตโนมัติ (ไม่ต้องแก้ @RequireAddon 13 controllers)
- ปรับ bundle matrix: Starter=Housekeeping · Pro=+Maintenance/Restaurant/CRM · Business=ครบ 7 module

## Files Modified
- `prisma/schema.prisma`, `prisma/migrations/20260630120000_add_system_and_fold_modules/migration.sql`
- `src/plans/plans.service.ts`, `src/plans/entities/plan.entity.ts`
- `src/modules/addons/dto/create-addon.dto.ts`, `src/modules/addons/addon.service.ts`
- `src/seeder/seeder.service.ts`

## Next Steps
- รัน `npx prisma generate` + `npx prisma migrate deploy` (หรือ `db push`) แล้ว `npm run seed`
- API `/plans/public` + `/addons/public` filter ตาม `system` + nest feature ใต้ module
- UI pricing / admin ให้โชว์เป็น tree + แยกระบบ
- เพิ่ม Retail POS card ใน sub_system_meta ของ INVENTORY
