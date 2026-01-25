# 📋 StaySync Admin Panel - Development Documentation

> เอกสารสรุปการพัฒนาระบบ Admin Panel สำหรับ StaySync SaaS Platform

---

## 📑 สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [โครงสร้างที่มีอยู่แล้ว](#2-โครงสร้างที่มีอยู่แล้ว)
3. [APIs ที่พัฒนาเสร็จแล้ว](#3-apis-ที่พัฒนาเสร็จแล้ว)
4. [สิ่งที่ยังขาด](#4-สิ่งที่ยังขาด)
5. [แผนการพัฒนา (Roadmap)](#5-แผนการพัฒนา-roadmap)
6. [API Specifications](#6-api-specifications)
7. [Database Schema](#7-database-schema)
8. [Test Credentials](#8-test-credentials)

---

## 1. ภาพรวมระบบ

### 🎯 เป้าหมาย
ระบบ Admin Panel สำหรับ Platform Admin ในการจัดการ:
- โรงแรมทั้งหมด (Hotels Management)
- ใบแจ้งหนี้ (Invoices Management)
- การสมัครใช้งาน (Subscriptions Management)
- แพ็กเกจและ Add-ons (Plans & Features)

### 🔐 ผู้ใช้งาน
- **Role:** `platform_admin`
- **API Prefix:** `/api/v1/admin/`

### 🛠 Tech Stack
- **Backend:** NestJS + TypeScript
- **Database:** MySQL (TypeORM + Prisma)
- **Authentication:** JWT Bearer Token
- **Documentation:** Swagger

---

## 2. โครงสร้างที่มีอยู่แล้ว

### 📁 Project Structure

```
src/
├── admin/                          # ✅ Admin Panel Module
│   ├── admin.module.ts
│   ├── admin-hotels.controller.ts
│   ├── admin-hotels.service.ts
│   ├── admin-invoices.controller.ts
│   ├── admin-invoices.service.ts
│   ├── admin-subscriptions.controller.ts
│   ├── admin-subscriptions.service.ts
│   └── dto/
│       ├── admin-hotels.dto.ts
│       ├── admin-invoices.dto.ts
│       └── admin-subscriptions.dto.ts
│
├── subscriptions/                  # ✅ Subscriptions Module
├── subscription-features/          # ✅ Add-ons Module
├── subscription-management/        # ✅ Upgrade/Downgrade Module
├── invoices/                       # ✅ Invoices Module
├── invoice-items/                  # ✅ Invoice Items Module
├── payments/                       # ✅ Payments Module
├── tenants/                        # ✅ Hotels/Tenants Module
├── plans/                          # ✅ Plans Module
├── features/                       # ✅ Features Module
└── seeder/                         # ✅ Database Seeder
```

### 📊 Database Tables

| Table | Description | Status |
|-------|-------------|--------|
| `tenants` | ข้อมูลโรงแรม | ✅ พร้อม |
| `subscriptions` | การสมัครใช้งาน | ✅ พร้อม |
| `subscription_features` | Add-ons ที่เลือกใช้ | ✅ พร้อม |
| `plans` | แพ็กเกจ (Starter, Pro, Enterprise) | ✅ พร้อม |
| `features` | รายการ Add-ons | ✅ พร้อม |
| `invoices` | ใบแจ้งหนี้ | ✅ พร้อม |
| `invoice_items` | รายการในใบแจ้งหนี้ | ✅ พร้อม |
| `payments` | การชำระเงิน | ✅ พร้อม |
| `users` | ผู้ใช้งาน (Prisma) | ✅ พร้อม |

---

## 3. APIs ที่พัฒนาเสร็จแล้ว

### 🏨 Hotels Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/admin/hotels` | รายการโรงแรมทั้งหมด (filter, search, pagination) |
| `GET` | `/api/v1/admin/hotels/summary` | สรุปจำนวนตามสถานะ |
| `GET` | `/api/v1/admin/hotels/:id` | รายละเอียดโรงแรม |
| `PATCH` | `/api/v1/admin/hotels/:id/status` | เปลี่ยนสถานะ (suspend/activate) |
| `POST` | `/api/v1/admin/hotels/:id/notify` | ส่ง notification |

### 💸 Invoices Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/admin/invoices` | รายการใบแจ้งหนี้ทั้งหมด |
| `GET` | `/api/v1/admin/invoices/summary` | สรุปจำนวนตามสถานะ |
| `GET` | `/api/v1/admin/invoices/:id` | รายละเอียดใบแจ้งหนี้ |
| `PATCH` | `/api/v1/admin/invoices/:id/status` | อนุมัติ/ปฏิเสธ |

### 📦 Subscriptions Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/admin/subscriptions` | รายการ subscription ทั้งหมด |
| `GET` | `/api/v1/admin/subscriptions/summary` | สรุป Active, Trial, MRR, Upgrades |
| `GET` | `/api/v1/admin/subscriptions/:id` | รายละเอียด subscription |
| `PATCH` | `/api/v1/admin/subscriptions/:id/status` | เปลี่ยนสถานะ |

### Response Format มาตรฐาน

```json
{
  "total": 10,
  "page": 1,
  "limit": 10,
  "data": [...]
}
```

---

## 4. สิ่งที่ยังขาด

### ❌ Add-on Management

| ฟีเจอร์ | สถานะ | หมายเหตุ |
|---------|--------|----------|
| แก้ไข Add-on (quantity/price) | ❌ ไม่มี | ไม่มี PATCH endpoint |
| ลบ Add-on พร้อม Credit | ❌ ไม่มี | ลบได้แต่ไม่คิด proration |
| Add-on History | ❌ ไม่มี | ไม่มี audit log |

### ❌ Billing Cycle

| ฟีเจอร์ | สถานะ | หมายเหตุ |
|---------|--------|----------|
| เปลี่ยนรอบบิล (monthly/yearly) | ❌ ไม่มี | ไม่มี field `billing_cycle` |
| ต่ออายุ manual | ❌ ไม่มี | - |
| ยกเลิก auto-renew | ⚠️ บางส่วน | มี field แต่ไม่มี endpoint |

### ❌ Invoice Adjustment

| ฟีเจอร์ | สถานะ | หมายเหตุ |
|---------|--------|----------|
| ปรับยอด Invoice (discount) | ❌ ไม่มี | - |
| Credit Memo | ❌ ไม่มี | - |
| Void Invoice | ❌ ไม่มี | - |
| Invoice Adjustment Log | ❌ ไม่มี | - |

### ❌ Refund & Credit

| ฟีเจอร์ | สถานะ | หมายเหตุ |
|---------|--------|----------|
| คืนเงิน (Refund) | ❌ ไม่มี | - |
| Credit Balance | ❌ ไม่มี | ไม่มี table |
| ใช้ Credit | ❌ ไม่มี | - |

---

## 5. แผนการพัฒนา (Roadmap)

### 📍 Phase 1: Add-on Management ⭐ Priority High

**เป้าหมาย:** แก้ไข, ลบ Add-ons พร้อมคำนวณ proration

**APIs ที่ต้องสร้าง:**

```
PATCH  /api/v1/admin/subscription-features/:id
POST   /api/v1/admin/subscription-features/:id/remove
GET    /api/v1/admin/subscription-features/:subscriptionId
```

**Database Changes:**
- เพิ่ม `subscription_feature_logs` table สำหรับ audit

**ระยะเวลาประมาณ:** 2-3 วัน

---

### 📍 Phase 2: Invoice Adjustment ⭐ Priority High

**เป้าหมาย:** ปรับยอด Invoice, ออก Credit Memo

**APIs ที่ต้องสร้าง:**

```
POST   /api/v1/admin/invoices/:id/adjust
POST   /api/v1/admin/invoices/:id/void
GET    /api/v1/admin/invoices/:id/adjustments
PATCH  /api/v1/admin/invoice-items/:id
```

**Database Changes:**
- เพิ่ม `invoice_adjustments` table
- เพิ่ม fields: `original_amount`, `adjusted_amount`, `voided_at`

**ระยะเวลาประมาณ:** 2-3 วัน

---

### 📍 Phase 3: Billing Cycle Management

**เป้าหมาย:** จัดการรอบบิล, ต่ออายุ manual

**APIs ที่ต้องสร้าง:**

```
PATCH  /api/v1/admin/subscriptions/:id/billing-cycle
POST   /api/v1/admin/subscriptions/:id/renew
POST   /api/v1/admin/subscriptions/:id/cancel-renewal
GET    /api/v1/admin/subscriptions/:id/billing-history
```

**Database Changes:**
- เพิ่ม fields ใน `subscriptions`:
  - `billing_cycle` ENUM('monthly', 'yearly')
  - `next_billing_date` DATE
  - `billing_anchor_date` DATE

**ระยะเวลาประมาณ:** 2-3 วัน

---

### 📍 Phase 4: Refund & Credit System

**เป้าหมาย:** ระบบคืนเงินและ Credit Balance

**APIs ที่ต้องสร้าง:**

```
POST   /api/v1/admin/payments/:id/refund
GET    /api/v1/admin/tenants/:id/credits
POST   /api/v1/admin/tenants/:id/credits
POST   /api/v1/admin/invoices/:id/apply-credit
```

**Database Changes:**
- เพิ่ม `tenant_credits` table
- เพิ่ม `payment_refunds` table

**ระยะเวลาประมาณ:** 3-4 วัน

---

## 6. API Specifications

### Phase 1: Add-on Management

#### PATCH /api/v1/admin/subscription-features/:id

**Request:**
```json
{
  "quantity": 5,
  "price": 990,
  "effectiveDate": "2024-02-01"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Add-on updated successfully",
  "data": {
    "id": "uuid",
    "featureName": "Extra Analytics",
    "oldPrice": 500,
    "newPrice": 990,
    "proratedAmount": 245
  }
}
```

#### POST /api/v1/admin/subscription-features/:id/remove

**Request:**
```json
{
  "reason": "Customer request",
  "effectiveDate": "2024-02-01",
  "createCredit": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Add-on removed successfully",
  "data": {
    "removedFeature": "Extra Analytics",
    "creditAmount": 495,
    "creditId": "uuid"
  }
}
```

---

### Phase 2: Invoice Adjustment

#### POST /api/v1/admin/invoices/:id/adjust

**Request:**
```json
{
  "type": "discount",
  "amount": -500,
  "reason": "Promotional discount",
  "description": "New year promotion 2024"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Invoice adjusted successfully",
  "data": {
    "invoiceNo": "INV-2024-001",
    "originalAmount": 7470,
    "adjustmentAmount": -500,
    "newAmount": 6970,
    "adjustmentId": "uuid"
  }
}
```

---

## 7. Database Schema

### Existing Tables

```sql
-- subscriptions (updated)
CREATE TABLE subscriptions (
  id VARCHAR(36) PRIMARY KEY,
  subscription_code VARCHAR(50) UNIQUE,
  tenant_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(36) NOT NULL,
  previous_plan_id VARCHAR(36),           -- สำหรับ upgrade/downgrade
  status ENUM('trial','pending','active','expired'),
  start_date DATE,
  end_date DATE,
  auto_renew BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- subscription_features
CREATE TABLE subscription_features (
  id VARCHAR(36) PRIMARY KEY,
  subscription_id VARCHAR(36) NOT NULL,
  feature_id VARCHAR(36) NOT NULL,
  quantity INT DEFAULT 1,
  price DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  FOREIGN KEY (feature_id) REFERENCES features(id)
);
```

### New Tables (Phase 1-4)

```sql
-- subscription_feature_logs (Phase 1)
CREATE TABLE subscription_feature_logs (
  id VARCHAR(36) PRIMARY KEY,
  subscription_feature_id VARCHAR(36),
  action ENUM('added','updated','removed'),
  old_price DECIMAL(10,2),
  new_price DECIMAL(10,2),
  old_quantity INT,
  new_quantity INT,
  reason TEXT,
  created_by VARCHAR(36),
  created_at TIMESTAMP
);

-- invoice_adjustments (Phase 2)
CREATE TABLE invoice_adjustments (
  id VARCHAR(36) PRIMARY KEY,
  invoice_id VARCHAR(36) NOT NULL,
  type ENUM('discount','surcharge','credit','refund'),
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT,
  description TEXT,
  created_by VARCHAR(36),
  created_at TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);

-- tenant_credits (Phase 4)
CREATE TABLE tenant_credits (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  type ENUM('refund','proration','promotional','manual'),
  reason TEXT,
  expires_at DATE,
  used_amount DECIMAL(10,2) DEFAULT 0,
  created_by VARCHAR(36),
  created_at TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- payment_refunds (Phase 4)
CREATE TABLE payment_refunds (
  id VARCHAR(36) PRIMARY KEY,
  payment_id VARCHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT,
  status ENUM('pending','completed','failed'),
  refunded_by VARCHAR(36),
  refunded_at TIMESTAMP,
  created_at TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
);
```

---

## 8. Test Credentials

### Platform Admin Login

```
Email: platform.admin@staysync.io
Password: admin123
```

### Test Command

```bash
# Refresh database and seed test data
npm run db:refresh

# Start development server
npm run start:dev

# API Base URL
http://localhost:3000/api/v1
```

### Postman Collection

ไฟล์: `postman/StaySync_Admin_Panel_API.postman_collection.json`

---

## 📝 Change Log

| วันที่ | Version | รายละเอียด |
|--------|---------|------------|
| 2024-01-25 | 1.0.0 | สร้าง Admin Hotels, Invoices, Subscriptions APIs |
| 2024-01-25 | 1.1.0 | เพิ่ม previousPlan, subscriptionCode, addons array |
| - | 1.2.0 | (Planned) Phase 1: Add-on Management |
| - | 1.3.0 | (Planned) Phase 2: Invoice Adjustment |
| - | 1.4.0 | (Planned) Phase 3: Billing Cycle |
| - | 1.5.0 | (Planned) Phase 4: Refund & Credit |

---

## 📞 Contact

**Developer:** -  
**Repository:** owner-hotel-services-api  
**Documentation:** `/api/docs` (Swagger)

---

*Last updated: January 25, 2024*
