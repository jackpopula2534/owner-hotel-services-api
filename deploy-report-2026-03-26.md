# ผลตรวจสอบก่อน Deploy — StaySync Hotel Management
**อัปเดตล่าสุด:** 2026-03-26 (UTC+7) — Run ที่ 4
**Task:** deploy-hotel-api-docker (automated scheduled run)

---

```
═══════════════════════════════════════════════════
  ผลตรวจสอบก่อน Deploy — StaySync
═══════════════════════════════════════════════════

สถานะ: ✅ พร้อม Deploy (มีข้อสังเกต 3 รายการ)

ผลตรวจสอบ:
  .env                    → ✅ ผ่าน (13 keys ครบ รวม JWT_SECRET 128 ตัวอักษร)
  TypeScript compile      → ✅ ผ่าน (exit code 0 ไม่มี error แม้แต่จุดเดียว)
  Prisma schema           → ✅ ผ่าน (binaryTargets มี debian-openssl-3.0.x ✓)
  Dockerfile (Backend)    → ✅ พบ (multi-stage build, node:20-slim)
  Dockerfile (Frontend)   → ⚠️  ไม่พบ (ไม่มี Next.js frontend ใน folder ที่ mount)
  docker-compose files    → ⚠️  พบ docker-compose.yml (ไม่มี dev/prod แยกกัน)
  entrypoint.sh           → ✅ พบ (prisma db push + node dist/main.js)
  deploy.sh               → ⚠️  ไม่พบ (ไม่มี GitHub root folder ที่ mount)
  .env ใน .gitignore      → ✅ ปลอดภัย (.env อยู่ใน .gitignore เรียบร้อย)

Prisma Migrations: 11 ไฟล์
  ล่าสุด: 20260326000000_add_room_extended_fields

═══════════════════════════════════════════════════
  คำสั่ง Deploy — Copy ไปรันบน Terminal ของ Mac
═══════════════════════════════════════════════════

📍 หมายเหตุ: เปลี่ยน <path> เป็น path จริงของโปรเจ็คบนเครื่องคุณ
   ตัวอย่าง: ~/Documents/GitHub/owner-hotel-services-api

วิธีที่ 1 — One-Click Deploy (ทั้งระบบ Backend):
  cd <path>/owner-hotel-services-api
  docker compose -f docker-compose.yml up --build -d

วิธีที่ 2 — Deploy เฉพาะ API (MySQL+Redis รันอยู่แล้ว):
  cd <path>/owner-hotel-services-api
  docker compose -f docker-compose.yml up --build -d api

วิธีที่ 3 — ดู logs หลัง deploy:
  docker logs hotel-api --tail 30
  docker compose -f docker-compose.yml ps

วิธีที่ 4 — ทดสอบ API:
  curl -s http://localhost:9011/api/v1/health

═══════════════════════════════════════════════════
  หลัง Deploy เสร็จ — ตรวจสอบด้วยคำสั่งนี้
═══════════════════════════════════════════════════

  ดูสถานะ  → docker compose -f docker-compose.yml ps
  ดู logs   → docker compose -f docker-compose.yml logs -f
  หยุดระบบ  → docker compose -f docker-compose.yml down
  รีสตาร์ท  → docker compose -f docker-compose.yml restart

บริการหลัง deploy สำเร็จ:
  API         → http://localhost:9011/api
  Swagger     → http://localhost:9011/api/docs
  DB Admin    → http://localhost:8080  (Adminer)
  MySQL       → port 3306 (internal)
  Redis       → port 6379 (internal)

DB Admin Login (Adminer):
  Server: mysql | User: root | Pass: (ดูใน .env) | DB: hotel_services_db

Rollback (กลับ image เดิม — ไม่ build ใหม่):
  docker compose -f docker-compose.yml down
  docker compose -f docker-compose.yml up -d
```

---

## รายละเอียดข้อสังเกต

### ⚠️ 1. docker-compose.yml มีไฟล์เดียว (ไม่มี dev/prod แยก)
ในโปรเจ็คนี้มีเพียง `docker-compose.yml` ไฟล์เดียว ไม่มี `docker-compose.dev.yml` หรือ `docker-compose.prod.yml`
ใช้คำสั่ง `docker compose -f docker-compose.yml` แทนได้เลย

### ⚠️ 2. ไม่พบ Next.js Frontend และ deploy.sh
- Folder ที่ mount มาคือ `owner-hotel-services-api` (Backend NestJS) และ `owner-hotel-services-mobile` (React Native)
- ไม่มี Next.js frontend และ deploy.sh ที่กล่าวถึงใน task
- ถ้าต้องการ deploy frontend ด้วย ให้ mount folder `owner-hotel-services` (Next.js) เพิ่มเข้ามา

### ⚠️⚠️ 3. entrypoint.sh ใช้ `prisma db push --accept-data-loss`
```sh
npx prisma db push --accept-data-loss
```
**ความเสี่ยง:** `--accept-data-loss` อาจทำให้ **ข้อมูลสูญหาย** ใน production!
**แนะนำ:** เปลี่ยนเป็น `npx prisma migrate deploy` สำหรับ production environment

---

## ผลตรวจสอบ .env

| Key | สถานะ |
|-----|-------|
| DB_HOST | ✅ ตั้งค่าแล้ว |
| DB_PORT | ✅ ตั้งค่าแล้ว |
| DB_USERNAME | ✅ ตั้งค่าแล้ว |
| DB_PASSWORD | ✅ ตั้งค่าแล้ว |
| DB_DATABASE | ✅ `hotel_services_db` |
| JWT_SECRET | ✅ 128 ตัวอักษร (preview: `952b9e6b...`) |
| JWT_EXPIRES_IN | ✅ ตั้งค่าแล้ว |
| DATABASE_URL | ✅ ตั้งค่าแล้ว |
| FRONTEND_URL | ✅ ตั้งค่าแล้ว |
| NEXT_PUBLIC_API_URL | ✅ ตั้งค่าแล้ว |
| NODE_ENV | ✅ ตั้งค่าแล้ว |
| PORT | ✅ ตั้งค่าแล้ว |
| ALLOWED_ORIGINS | ✅ ตั้งค่าแล้ว |

---

## Prisma Schema

- **Provider:** MySQL
- **binaryTargets:** native, `debian-openssl-3.0.x` ✅, linux-arm64-openssl-3.0.x, linux-arm64-openssl-1.1.x
- **Migrations:** 11 ไฟล์

| Migration | หมายเหตุ |
|-----------|---------|
| `20260326000000_add_room_extended_fields` | ล่าสุด — วันนี้ |
| `20260325000000_add_user_tenant_junction_table` | เมื่อวาน |
| `20260209000000_add_missing_tables_and_columns` | ก.พ. 2026 |
| `20260208000002_add_property_addon_feature` | |
| `20260208000001_add_max_properties_to_plans` | |
| `20260208000000_add_property_model` | |
| `20260204000000_add_admin_to_refresh_token` | |
| `20251218035041_` | |
| `20251217100942_` | |
| `20251217081642_add_tenant_columns` | |
| `20251217081641_` | |

---

*รายงานนี้สร้างโดยอัตโนมัติจาก scheduled task — 26 มีนาคม 2026*
