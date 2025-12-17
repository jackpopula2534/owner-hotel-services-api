# 🚀 Quick Start Guide

## คำสั่งเดียวสำหรับ Setup Database

### 🔄 Refresh Database + Seed (คำสั่งเดียว)

```bash
npm run db:refresh
```

**คำสั่งนี้จะทำ:**
1. 🗑️ ลบ tables ทั้งหมด (Drop all tables)
2. 🔨 สร้าง tables ใหม่ (Recreate tables)
3. 🌱 Seed ข้อมูลเริ่มต้น (Seed initial data)

---

## 📋 คำสั่งอื่นๆ

### Seed เท่านั้น (ไม่ลบข้อมูล)
```bash
npm run seed
```

### รัน Development Server
```bash
npm run start:dev
```

### Build Production
```bash
npm run build
npm run start:prod
```

---

## ⚠️ คำเตือน

**`npm run db:refresh` จะลบข้อมูลทั้งหมดใน database!**

- ✅ ใช้ได้ใน **Development** environment
- ❌ **ห้ามใช้** ใน Production
- 💾 ควร backup database ก่อนรัน (ถ้ามีข้อมูลสำคัญ)

---

## 🎯 Workflow แนะนำ

### ครั้งแรกที่ Setup
```bash
# 1. ติดตั้ง dependencies
npm install

# 2. ตั้งค่า .env (ตรวจสอบ MAMP connection)

# 3. Refresh + Seed database
npm run db:refresh

# 4. รัน server
npm run start:dev
```

### เมื่อต้องการ Reset Database
```bash
npm run db:refresh
```

### เมื่อต้องการ Seed เพิ่มเติม (ไม่ลบข้อมูลเดิม)
```bash
npm run seed
```

---

## 📊 ข้อมูลที่ถูก Seed

หลังจากรัน `npm run db:refresh` จะได้:

- ✅ **3 Plans** (S, M, L)
- ✅ **8 Features** (OTA, Automation, Tax Invoice, etc.)
- ✅ **Plan Features** (ฟีเจอร์ที่แถมมากับ plan)
- ✅ **3 Admin Users** (Super, Finance, Support)
- ✅ **Sample Hotel** (สำหรับทดสอบ)

---

## 🔍 ตรวจสอบผลลัพธ์

### ผ่าน API
```bash
# ตรวจสอบ Plans
curl http://localhost:3000/plans

# ตรวจสอบ Features
curl http://localhost:3000/features

# ตรวจสอบ Admins
curl http://localhost:3000/admins
```

### ผ่าน phpMyAdmin
1. เปิด `http://localhost:8888/phpMyAdmin`
2. เลือก database `hotel_services_db`
3. ดู tables และข้อมูล

---

## 🐛 Troubleshooting

### Error: Cannot connect to database
- ตรวจสอบ MAMP ทำงานอยู่
- ตรวจสอบ `.env` ตั้งค่าถูกต้อง
- ตรวจสอบ database `hotel_services_db` สร้างแล้ว

### Error: Access denied
- ตรวจสอบ username/password ใน `.env`
- ตรวจสอบ MySQL port (8889 หรือ 3306)

### Error: Database not found
- สร้าง database ก่อน:
  ```sql
  CREATE DATABASE hotel_services_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

---

## 📝 Example Output

```
🔄 Starting database refresh and seed...

🗑️  Dropping all tables...
  ✓ All tables dropped

🔨 Creating tables...
  ✓ All tables created

🌱 Seeding data...
📦 Seeding Plans...
  ✓ Created plan: S - Starter Plan
  ✓ Created plan: M - Medium Plan
  ✓ Created plan: L - Large Plan
⚙️ Seeding Features...
  ✓ Created feature: ota_booking - OTA Booking Integration
  ...
✅ Database refresh and seed completed successfully!

📊 Summary:
  - Database: Refreshed
  - Tables: Recreated
  - Data: Seeded
```

---

## 🎉 พร้อมใช้งาน!

หลังจากรัน `npm run db:refresh` สำเร็จ:

1. ✅ Database พร้อมใช้งาน
2. ✅ ข้อมูลเริ่มต้นถูก seed แล้ว
3. ✅ สามารถทดสอบ API ได้ทันที

**Happy Coding! 🚀**


