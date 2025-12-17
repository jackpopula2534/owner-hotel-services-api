# 🌱 Database Seeder Guide

## ข้อมูลที่ Seeder จะสร้าง

### 1️⃣ Plans (แพ็กเกจหลัก)
- **Plan S (Starter)** - 990 บาท/เดือน, 20 ห้อง, 3 users
- **Plan M (Medium)** - 1,990 บาท/เดือน, 50 ห้อง, 5 users
- **Plan L (Large)** - 3,990 บาท/เดือน, 100 ห้อง, 10 users

### 2️⃣ Features (ฟีเจอร์เสริม)
- `ota_booking` - OTA Booking Integration (500 บาท/เดือน)
- `automation` - Automation System (300 บาท/เดือน)
- `tax_invoice` - Tax Invoice (200 บาท/เดือน)
- `extra_user` - Extra User (100 บาท/เดือน)
- `api_access` - API Access (400 บาท/เดือน)
- `advanced_report` - Advanced Report (250 บาท/เดือน)
- `housekeeping` - Housekeeping Management (150 บาท/เดือน)
- `basic_report` - Basic Report (ฟรี)

### 3️⃣ Plan Features (ฟีเจอร์ที่แถมมากับ plan)
- **Plan S**: Basic Report
- **Plan M**: Basic Report + Housekeeping
- **Plan L**: Basic Report + Housekeeping + Advanced Report

### 4️⃣ Admin Users
- **Super Admin** - admin@hotelservices.com
- **Finance Admin** - finance@hotelservices.com
- **Support Admin** - support@hotelservices.com

### 5️⃣ Sample Data (สำหรับทดสอบ)
- Sample Hotel (โรงแรมตัวอย่าง) - Trial status, 14 วัน

---

## 🚀 วิธีใช้งาน

### วิธีที่ 1: ผ่าน Command Line (แนะนำ)

```bash
npm run seed
```

### วิธีที่ 2: ผ่าน API Endpoint

```bash
# ต้องรัน server ก่อน
npm run start:dev

# จากนั้นเรียก API
curl -X POST http://localhost:3000/seeder/run
```

---

## 📋 ขั้นตอนการ Seed

1. **ตรวจสอบว่า Database เชื่อมต่อได้**
   ```bash
   # ตรวจสอบ .env
   cat .env
   ```

2. **รัน Seeder**
   ```bash
   npm run seed
   ```

3. **ตรวจสอบผลลัพธ์**
   - ดู log ใน console
   - ตรวจสอบใน phpMyAdmin หรือ MySQL client

---

## ✅ ข้อมูลที่ถูกสร้าง

### Plans
```sql
SELECT * FROM plans;
-- จะเห็น 3 plans: S, M, L
```

### Features
```sql
SELECT * FROM features;
-- จะเห็น 8 features
```

### Plan Features
```sql
SELECT pf.*, p.code as plan_code, f.code as feature_code
FROM plan_features pf
JOIN plans p ON pf.plan_id = p.id
JOIN features f ON pf.feature_id = f.id;
```

### Admins
```sql
SELECT * FROM admins;
-- จะเห็น 3 admins
```

---

## 🔄 Re-seed (Seed ซ้ำ)

Seeder ถูกออกแบบให้ **ไม่สร้างข้อมูลซ้ำ**:
- ถ้ามีข้อมูลอยู่แล้ว → ข้าม (แสดง `⊙ already exists`)
- ถ้ายังไม่มี → สร้างใหม่ (แสดง `✓ Created`)

**ตัวอย่าง Output:**
```
🌱 Starting database seeding...
📦 Seeding Plans...
  ✓ Created plan: S - Starter Plan
  ⊙ Plan already exists: M
  ✓ Created plan: L - Large Plan
⚙️ Seeding Features...
  ✓ Created feature: ota_booking - OTA Booking Integration
  ...
✅ Database seeding completed successfully!
```

---

## ⚠️ หมายเหตุ

1. **Development Only**: Seeder ควรใช้เฉพาะ development environment
2. **ไม่ลบข้อมูลเดิม**: Seeder จะไม่ลบข้อมูลที่มีอยู่แล้ว
3. **Sample Data**: Sample tenant จะถูกสร้างถ้ายังไม่มี

---

## 🛠️ Customize Seeder

ถ้าต้องการแก้ไขข้อมูลที่ seed:

1. แก้ไขไฟล์ `src/seeder/seeder.service.ts`
2. เพิ่ม/แก้ไขข้อมูลใน methods:
   - `seedPlans()` - แก้ไข plans
   - `seedFeatures()` - แก้ไข features
   - `seedPlanFeatures()` - แก้ไข plan-feature relationships
   - `seedAdmins()` - แก้ไข admins
   - `seedSampleData()` - แก้ไข sample data

---

## 🧪 Testing

หลังจาก seed แล้ว ทดสอบ:

```bash
# ตรวจสอบ Plans
curl http://localhost:3000/plans

# ตรวจสอบ Features
curl http://localhost:3000/features

# ตรวจสอบ Admins
curl http://localhost:3000/admins

# ตรวจสอบ Feature Access
curl "http://localhost:3000/feature-access/check?tenantId=xxx&featureCode=ota_booking"
```

---

## 📝 Checklist

- [ ] Database เชื่อมต่อได้
- [ ] รัน `npm run seed` สำเร็จ
- [ ] ตรวจสอบข้อมูลใน database
- [ ] ทดสอบ API endpoints

---

## 🚨 Troubleshooting

### Error: Cannot connect to database
- ตรวจสอบ MAMP ทำงานอยู่
- ตรวจสอบ `.env` ตั้งค่าถูกต้อง
- ตรวจสอบ database `hotel_services_db` สร้างแล้ว

### Error: Duplicate entry
- ไม่เป็นไร Seeder จะข้ามข้อมูลที่มีอยู่แล้ว

### Error: Feature not found
- ตรวจสอบว่า seed features ก่อน plan features

---

## 🎯 Next Steps

หลังจาก seed สำเร็จ:

1. ทดสอบ API endpoints
2. สร้าง tenant ใหม่ผ่าน `/onboarding/register`
3. ทดสอบ feature access
4. ทดสอบ admin approval flow


