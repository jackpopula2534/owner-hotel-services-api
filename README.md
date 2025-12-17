# Owner Hotel Services API

SaaS Hotel Management System API built with NestJS

## 🏗️ Database Structure

ระบบออกแบบมาเพื่อตอบ 4 คำถามหลัก:
1. **โรงแรมนี้ใช้ plan อะไร?** → `subscriptions.plan_id`
2. **เปิด feature อะไรบ้าง?** → `plan_features` + `subscription_features`
3. **ใช้งานได้ถึงวันไหน?** → `subscriptions.end_date`
4. **จ่ายเงินรึยัง / ใคร approve?** → `payments.status` + `payments.approved_by`

### Database Tables

1. **tenants** - โรงแรม/ลูกค้า SaaS
2. **plans** - แพ็กเกจหลัก (S, M, L)
3. **features** - ฟีเจอร์เสริม (toggle, limit, module)
4. **plan_features** - ฟีเจอร์ที่แถมมากับ plan
5. **subscriptions** - สัญญาใช้งาน
6. **subscription_features** - ฟีเจอร์ที่ซื้อเพิ่ม
7. **invoices** - ใบแจ้งหนี้
8. **invoice_items** - รายละเอียดบิล
9. **payments** - หลักฐานการจ่าย
10. **admins** - ผู้ดูแลระบบ

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- MAMP (MySQL) หรือ MySQL Server
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# ไฟล์ .env ถูกสร้างไว้แล้วสำหรับ MAMP
# ถ้ายังไม่มี ให้ copy จาก .env.example
```

### Database Setup (MAMP)

**1. เปิด MAMP และ Start Servers**

**2. สร้าง Database:**
```bash
# ผ่าน Terminal
mysql -u root -proot -h localhost -P 8889

CREATE DATABASE hotel_services_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
exit;
```

หรือผ่าน phpMyAdmin: `http://localhost:8888/phpMyAdmin`

**3. ตรวจสอบไฟล์ `.env`:**
```env
DB_HOST=localhost
DB_PORT=8889        # MAMP default port
DB_USERNAME=root
DB_PASSWORD=root
DB_DATABASE=hotel_services_db
```

**⚠️ หมายเหตุ:** 
- ถ้า MAMP ใช้ port `3306` ให้แก้ไข `DB_PORT=3306`
- ดูรายละเอียดเพิ่มเติมใน [MAMP_SETUP.md](./MAMP_SETUP.md)

### Database Setup & Seeding

```bash
# 🔄 Refresh Database + Seed (คำสั่งเดียว - ลบและสร้างใหม่ทั้งหมด)
npm run db:refresh

# 🌱 Seed เท่านั้น (ไม่ลบข้อมูลเดิม)
npm run seed
```

**⚠️ คำเตือน:** `npm run db:refresh` จะลบข้อมูลทั้งหมดใน database! ใช้เฉพาะ development

### Running the Application

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📡 API Endpoints

### Tenants
- `GET /tenants` - List all tenants
- `GET /tenants/:id` - Get tenant details
- `POST /tenants` - Create tenant
- `PATCH /tenants/:id` - Update tenant
- `DELETE /tenants/:id` - Delete tenant

### Plans
- `GET /plans` - List all active plans
- `GET /plans/:id` - Get plan details
- `GET /plans/code/:code` - Get plan by code (S, M, L)
- `POST /plans` - Create plan
- `PATCH /plans/:id` - Update plan

### Features
- `GET /features` - List all active features
- `GET /features/:id` - Get feature details
- `GET /features/code/:code` - Get feature by code
- `POST /features` - Create feature
- `PATCH /features/:id` - Update feature

### Subscriptions
- `GET /subscriptions` - List all subscriptions
- `GET /subscriptions/:id` - Get subscription details
- `GET /subscriptions/tenant/:tenantId` - Get subscription by tenant
- `POST /subscriptions` - Create subscription
- `PATCH /subscriptions/:id` - Update subscription

### Feature Access (สำคัญ!)
- `GET /feature-access/check?tenantId=xxx&featureCode=ota_booking` - Check feature access
- `GET /feature-access/tenant/:tenantId/features` - Get all tenant features
- `GET /feature-access/tenant/:tenantId/subscription-status` - Get subscription status

### Invoices
- `GET /invoices` - List all invoices
- `GET /invoices/:id` - Get invoice details
- `GET /invoices/tenant/:tenantId` - Get invoices by tenant
- `POST /invoices` - Create invoice

### Payments
- `GET /payments` - List all payments
- `GET /payments/:id` - Get payment details
- `GET /payments/invoice/:invoiceId` - Get payments by invoice
- `POST /payments` - Create payment
- `POST /payments/:id/approve` - Approve payment
- `POST /payments/:id/reject` - Reject payment

## 🔐 Feature Flag Logic

ระบบใช้ Feature Access Service เพื่อตรวจสอบสิทธิ์การเข้าถึง:

```typescript
// ตรวจสอบว่า tenant มีสิทธิ์ใช้ feature หรือไม่
GET /feature-access/check?tenantId=xxx&featureCode=ota_booking

// Response
{
  "hasAccess": true/false,
  "reason": "message if denied",
  "subscription": {...},
  "feature": {...}
}
```

### Logic Flow:
1. ตรวจสอบ tenant status (ไม่ใช่ suspended/expired)
2. ตรวจสอบ subscription status (ต้องเป็น active)
3. ตรวจสอบวันที่ (today <= end_date)
4. ตรวจสอบ feature (ต้องอยู่ใน plan_features หรือ subscription_features)

## 🧩 Design Principles

- **Plan = ฐาน** - สิทธิ์พื้นฐาน
- **Feature = เงิน** - ฟีเจอร์เสริมสร้างรายได้
- **Subscription = เวลา** - ระยะเวลาการใช้งาน
- **Invoice = หลักฐาน** - หลักฐานทางบัญชี
- **Admin = คนถือกุญแจ** - ผู้มีสิทธิ์ approve

## 📝 Notes

- `tenant.status` ไม่ผูกกับ `subscription.status` ตรง ๆ (เผื่อ admin suspend)
- `feature.code` ห้ามเปลี่ยน ใช้ผูก logic
- ทุกการซื้อต้องมี invoice
- เงินยังไม่ใช่เงิน จน admin approve payment

# owner-hotel-services-api
# owner-hotel-services-api
