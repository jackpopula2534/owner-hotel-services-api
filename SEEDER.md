# 🌱 Database Seeder Guide (Updated)

ข้อมูลสำหรับ Database Seeder เพื่อใช้ในการพัฒนาและทดสอบระบบ (Development Environment)

---

## 📦 ข้อมูลที่ Seeder จะสร้าง

### 1️⃣ Subscription Plans (แพ็กเกจหลัก)
| Plan | Code | Monthly Price | Max Rooms | Max Users |
|------|------|---------------|-----------|-----------|
| **Starter** | `S` | 1,990 บาท | 20 | 3 |
| **Professional** | `M` | 4,990 บาท | 50 | 10 |
| **Enterprise** | `L` | 9,990 บาท | 200 | 50 |
| **Free Trial**| `FREE`| 0 บาท | 5 | 2 |

### 2️⃣ Features & Add-ons
- `features` = toggle/limit entitlement เช่น `basic_report`, `tax_invoice`, `advanced_report`, `api_access`
- `add_ons` = module entitlement เช่น `HR_MODULE`, `INVENTORY_MODULE`, `POS_MODULE`, `CHANNEL_MANAGER`
- `premium.test@email.com` ได้สิทธิ์ครบจาก 3 แหล่ง:
  - `plan_features` ของ Plan `L`
  - `plan_addons` ของ Plan `L`
  - `subscription_features` เพิ่มเติม 6 รายการ

---

## 🔑 Test Login Credentials

> [!IMPORTANT]
> **Admin (Platform)** และ **User (Hotel Owner/Staff)** ใช้ตารางแยกกัน และเข้าสู่ระบบผ่าน Endpoint คนละตัว

### 📌 1. Platform Admin
**Login via:** `POST /api/v1/auth/admin/login`

| Email | Password | Role |
|-------|----------|------|
| `admin@hotelservices.com` | `Admin@123` | Super Admin |
| `finance@hotelservices.com` | `Finance@123` | Finance Admin |
| `support@hotelservices.com` | `Support@123` | Support Admin |

### 📌 2. Hotel Owners (Tenant Admin)
**Login via:** `POST /api/v1/auth/login`
**Password:** `password123` (สำหรับเจ้าของทุกคน)

| Email | Hotel Name | Plan | Features |
|-------|------------|------|----------|
| **`premium.test@email.com`** | **Mountain View Resort** | **Enterprise (L)** | **ครบ plan features + plan add-ons + subscription features** |
| `somchai@email.com` | โรงแรมสุขใจ (Sukjai Hotel) | Professional (M) | Analytics, Branding |
| `seaside@email.com` | บ้านพักริมทะเล (Seaside Stay) | Starter (S) | Trial Mode |
| `garden@email.com` | Garden Resort & Spa | Professional (M) | - |

### 📌 3. Hotel Staff
**Email Format:** `{role}.{tenant_slug}@hotel.test`
**Password:** `Staff@123`

- **Manager**: `manager.mountain@hotel.test`, `manager.sukjai@hotel.test`
- **Receptionist**: `receptionist.mountain@hotel.test`, `receptionist.sukjai@hotel.test`

---

## 🚀 วิธีรัน Seeder

### วิธีที่ 1: Fresh Start (ล้างข้อมูลเก่าและลงใหม่ - แนะนำ)
คำสั่งนี้จะ Drop ตารางทั้งหมด, Migrate ใหม่ และ Seed ข้อมูลที่ถูกต้องที่สุด
```bash
npm run db:refresh
```

### วิธีที่ 2: เพิ่มข้อมูลใหม่ (ไม่ลบของเดิม)
```bash
npm run seed
```

---

## 🛠️ โครงสร้างข้อมูลทดสอบ (Demo Data)

- **Hotels**: สร้างไว้ 4 แห่ง (Active, Trial, Pending)
- **Guests**: สร้างแขกตัวอย่าง 10 คน (ไทย + ต่างชาติ)
- **Bookings**: สร้างการจอง 10-20 รายการ เพื่อทดสอบ Dashboard
- **Reviews**: สร้างรีวิวตัวอย่าง 5 รายการ
- **HR Data**: สร้างข้อมูลมาสเตอร์ HR (แผนก, ตำแหน่ง, ประเภทการลา) ให้ครบทุกโรงแรม

---

## 📝 Checklist หลัง Seed
1. [ ] เข้าสู่ระบบด้วย `admin@hotelservices.com` เพื่อดูภาพรวมระบบ (Admin Panel)
2. [ ] เข้าสู่ระบบด้วย `premium.test@email.com` เพื่อทดสอบฟีเจอร์ระดับ Enterprise + Add-ons ทั้งหมด
3. [ ] ตรวจสอบว่า `users` ในระบบมีจำนวนน้อยลง (ประมาณ 8-10 User) เพื่อความคลีนของข้อมูล
4. [ ] ตรวจสอบว่า Email ของ User ทั้งหมดไม่มีภาษาไทยปนอยู่ใน Slug
