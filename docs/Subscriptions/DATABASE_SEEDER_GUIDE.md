# Database Seeder Guide

## การรัน Seeder เพื่อสร้างข้อมูลตัวอย่าง

### คำสั่ง Refresh Database และ Seed ข้อมูล

```bash
npm run db:refresh
```

**⚠️ คำเตือน**: คำสั่งนี้จะ **ลบข้อมูลทั้งหมด** และสร้างข้อมูลใหม่ตั้งแต่ต้น

---

## 📦 ข้อมูลที่จะถูก Seed

### 1. Plans (แผนบริการ) - ตรงตาม UI Sales Page

#### Starter Plan
```
ราคา: ฿1,990/เดือน
รองรับ: 20 ห้อง
ผู้ใช้งาน: 3 คน
Features:
  - รองรับ 20 ห้อง
  - ผู้ใช้งาน 3 คน
  - ระบบจองครบครัน
ปุ่ม: "เริ่มใช้งาน"
```

#### Professional Plan (ยอดนิยม) ⭐
```
ราคา: ฿4,990/เดือน
รองรับ: 50 ห้อง
ผู้ใช้งาน: 10 คน
Features:
  - รองรับ 50 ห้อง
  - ผู้ใช้งาน 10 คน
  - ระบบจองครบครัน
Badge: "ยอดนิยม"
Highlight Color: #8B5CF6 (สีม่วง)
ปุ่ม: "เริ่มใช้งาน"
```

#### Enterprise Plan
```
ราคา: ฿9,990/เดือน
รองรับ: 200 ห้อง
ผู้ใช้งาน: 50 คน
Features:
  - รองรับ 200 ห้อง
  - ผู้ใช้งาน 50 คน
  - ระบบจองครบครัน
ปุ่ม: "เริ่มใช้งาน"
```

---

### 2. Features (ฟีเจอร์เสริม)

- **OTA Booking Integration** - ฿990/เดือน
- **Extra Analytics** - ฿990/เดือน
- **Custom Branding** - ฿1,490/เดือน
- **Automation System** - ฿990/เดือน
- **Tax Invoice** - ฿500/เดือน
- **Extra User** - ฿200/เดือน
- **API Access** - ฿1,500/เดือน
- **Advanced Report** - ฿500/เดือน
- **Housekeeping Management** - ฿500/เดือน
- **Basic Report** - ฿0/เดือน (ฟรี)

---

### 3. Plan Features (ฟีเจอร์ที่แถมมากับแผน)

- **Starter**: Basic Report
- **Professional**: Basic Report + Housekeeping
- **Enterprise**: Basic Report + Housekeeping + Advanced Report

---

### 4. Test Users

#### Platform Admin
```
Email: platform.admin@staysync.io
Password: admin123
Role: platform_admin
```

---

### 5. Admin Panel Test Data (6 โรงแรม)

| Code | Name | Plan | Status | Add-ons | MRR |
|------|------|------|--------|---------|-----|
| SUB-001 | โรงแรมสุขใจ | Professional | Active | Extra Analytics, Custom Branding | ฿7,470 |
| SUB-002 | Mountain View Resort | Enterprise | Active | OTA, Automation, API | ฿13,960 |
| SUB-003 | บ้านพักริมทะเล | Starter | Trial | - | ฿0 |
| SUB-004 | Garden Resort & Spa | Professional | Pending | - | ฿4,990 |
| SUB-005 | โรงแรมวิวภูเขา | Professional | Expired | OTA Booking | - |
| SUB-006 | Sunset Beach Hotel | Enterprise | Suspended | API Access | - |

**Total Active MRR**: ฿26,420

---

## 🚀 วิธีใช้งาน

### 1. Refresh Database และ Seed ข้อมูล

```bash
# ลบข้อมูลทั้งหมดและสร้างใหม่
npm run db:refresh
```

**ผลลัพธ์ที่ได้:**
```
🔄 Starting database refresh and seed...
🗑️  Dropping all tables...
  ✓ All user tables dropped
🔨 Running Prisma migrations...
  ✓ Prisma migrations completed
  ✓ Prisma client generated
  ✓ Prisma client reconnected
🔨 Creating TypeORM tables...
  ✓ All TypeORM tables created
🌱 Seeding data...
📦 Seeding Plans for Sales Page...
  ✓ Created plan: S - Starter (฿1990/mo)
  ✓ Created plan: M - Professional (฿4990/mo)
  ✓ Created plan: L - Enterprise (฿9990/mo)
⚙️ Seeding Features...
👤 Seeding Admins...
👥 Seeding Test Users...
🏨 Seeding Admin Panel Test Data...
✅ Database refresh and seed completed successfully!

📊 Summary:
  - Database: Refreshed
  - Prisma Tables: Created (users, guests, bookings, etc.)
  - TypeORM Tables: Created (subscriptions, plans, etc.)
  - Data: Seeded (including 5 test users)
```

---

### 2. ทดสอบ API

#### ทดสอบ Public Plans API (สำหรับ Sales Page)

```bash
# ดึงรายการแผนทั้งหมด (ไม่ต้อง auth)
curl http://localhost:3000/api/v1/plans
```

**Response ที่คาดหวัง:**
```json
{
  "data": [
    {
      "id": "uuid-starter",
      "code": "S",
      "name": "Starter",
      "description": "เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน",
      "priceMonthly": 1990,
      "maxRooms": 20,
      "maxUsers": 3,
      "displayOrder": 1,
      "isPopular": false,
      "badge": null,
      "highlightColor": null,
      "features": [
        "รองรับ 20 ห้อง",
        "ผู้ใช้งาน 3 คน",
        "ระบบจองครบครัน"
      ],
      "buttonText": "เริ่มใช้งาน",
      "addOnFeatures": []
    },
    {
      "id": "uuid-professional",
      "code": "M",
      "name": "Professional",
      "description": "เหมาะสำหรับโรงแรมขนาดกลาง พร้อมฟีเจอร์ครบครัน",
      "priceMonthly": 4990,
      "maxRooms": 50,
      "maxUsers": 10,
      "displayOrder": 2,
      "isPopular": true,
      "badge": "ยอดนิยม",
      "highlightColor": "#8B5CF6",
      "features": [
        "รองรับ 50 ห้อง",
        "ผู้ใช้งาน 10 คน",
        "ระบบจองครบครัน"
      ],
      "buttonText": "เริ่มใช้งาน",
      "addOnFeatures": []
    }
  ],
  "total": 3
}
```

---

#### ทดสอบ Admin Plans API

```bash
# 1. Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "platform.admin@staysync.io", "password": "admin123"}'

# 2. Copy accessToken จาก response

# 3. ดึงรายการแผน (ต้องมี token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/v1/admin/plans
```

---

### 3. ตรวจสอบข้อมูลใน Database

```sql
-- ดูแผนทั้งหมด
SELECT
  code,
  name,
  price_monthly,
  max_rooms,
  max_users,
  is_popular,
  badge,
  display_order
FROM plans
ORDER BY display_order;

-- ดูฟีเจอร์ทั้งหมด
SELECT code, name, price_monthly, type
FROM features
ORDER BY price_monthly DESC;

-- ดู Subscriptions
SELECT
  t.name as hotel_name,
  p.name as plan_name,
  s.status,
  s.subscription_code
FROM subscriptions s
JOIN tenants t ON s.tenant_id = t.id
JOIN plans p ON s.plan_id = p.id
ORDER BY s.created_at DESC;
```

---

## 🔄 การอัพเดท Seeder

ถ้าต้องการแก้ไขข้อมูล seed ให้แก้ไขที่:

**ไฟล์**: [src/seeder/seeder.service.ts](../../src/seeder/seeder.service.ts)

### แก้ไขข้อมูล Plans

```typescript
private async seedPlans(): Promise<void> {
  // แก้ไขข้อมูลที่นี่
  const plans = [
    {
      code: 'S',
      name: 'Starter',
      priceMonthly: 1990, // เปลี่ยนราคาได้ที่นี่
      // ...
    },
  ];
}
```

หลังจากแก้ไข ให้รัน:
```bash
npm run build
npm run db:refresh
```

---

## 📱 การทดสอบกับ Frontend

### React/Next.js Example

```typescript
// app/pricing/page.tsx
'use client';

import { useEffect, useState } from 'react';

export default function PricingPage() {
  const [plans, setPlans] = useState([]);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/plans')
      .then(res => res.json())
      .then(data => setPlans(data.data));
  }, []);

  return (
    <div className="pricing-page">
      <h1>เลือกแพ็กเกจที่เหมาะกับคุณ</h1>
      <p>เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน</p>

      <div className="plans-grid">
        {plans.map(plan => (
          <div
            key={plan.id}
            className={`plan-card ${plan.isPopular ? 'popular' : ''}`}
            style={{
              borderColor: plan.isPopular ? plan.highlightColor : '#e5e7eb'
            }}
          >
            {plan.isPopular && (
              <div
                className="badge"
                style={{ backgroundColor: plan.highlightColor }}
              >
                {plan.badge}
              </div>
            )}

            <h3>{plan.name}</h3>
            <div className="price">
              ฿{plan.priceMonthly.toLocaleString()}
              <span>/เดือน</span>
            </div>

            <p className="description">{plan.description}</p>

            <ul className="features">
              {plan.features?.map((feature, i) => (
                <li key={i}>✓ {feature}</li>
              ))}
            </ul>

            <button
              className="cta-button"
              style={{
                backgroundColor: plan.isPopular ? plan.highlightColor : '#6b7280'
              }}
            >
              {plan.buttonText}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## ⚠️ หมายเหตุสำคัญ

1. **Development Only**: คำสั่ง `db:refresh` ควรใช้ใน development environment เท่านั้น
2. **Data Loss**: การรัน `db:refresh` จะ **ลบข้อมูลทั้งหมด** โปรดระวัง!
3. **Production**: ใน production ใช้ migrations แทน seeder
4. **Backup**: สำรองข้อมูลก่อนรัน refresh เสมอ

---

## 🆘 การแก้ปัญหา

### ปัญหา: Database connection failed
```bash
# ตรวจสอบ .env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=hotel_services_db

# รัน MySQL
mysql.server start
```

### ปัญหา: Migration failed
```bash
# ลบ migrations ที่ล้มเหลว
npx prisma migrate reset

# รัน seeder ใหม่
npm run db:refresh
```

### ปัญหา: TypeORM sync error
```bash
# ตั้งค่า synchronize ใน development
# src/database/database.module.ts
synchronize: process.env.NODE_ENV === 'development'
```

---

## 📚 เอกสารเพิ่มเติม

- [Sales Page Integration Guide](./SALES_PAGE_INTEGRATION.md)
- [Admin Plans API Documentation](./ADMIN_PLANS_API.md)
- [Sample Plans Data SQL](./SAMPLE_PLANS_DATA.sql)
