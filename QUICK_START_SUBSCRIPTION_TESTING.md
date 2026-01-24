# 🚀 Quick Start: Testing Subscription Expiration

## 📋 Overview

เอกสารนี้จะแนะนำวิธีการ setup และทดสอบฟีเจอร์ Subscription Expiration อย่างรวดเร็วและครบถ้วน

**Prerequisites:**
- Node.js installed
- MySQL database (MAMP/XAMPP)
- Git
- API testing tool (curl, Postman, or Insomnia)

---

## ⚡ Quick Setup (3 Steps)

### Step 1: Database Setup

รันคำสั่งเดียวเพื่อ setup database พร้อม seed data:

```bash
npm run db:refresh
```

**สิ่งที่คำสั่งนี้ทำ:**
1. ✅ Drop existing database schema
2. ✅ Run all migrations (สร้าง tables ใหม่)
3. ✅ Seed initial data (Plans, Features, Admins, Sample Tenant)

**Output ตัวอย่าง:**
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
  ✓ Created feature: automation - Automation System
  ...
👤 Seeding Admins...
  ✓ Created admin: admin@hotelservices.com (super)
🏨 Seeding Sample Data...
  ✓ Created sample tenant: โรงแรมตัวอย่าง (Sample Hotel)

✅ Database refresh and seed completed successfully!
```

### Step 2: Start the Development Server

```bash
npm run start:dev
```

**Server จะรันที่:**
- API: `http://localhost:3001`
- Swagger Docs: `http://localhost:3001/api/docs`

### Step 3: Verify Setup

ทดสอบว่า API ทำงาน:

```bash
curl http://localhost:3001/api/v1/plans
```

---

## 📊 Understanding Seeded Data

หลังจากรัน `npm run db:refresh` ระบบจะ seed ข้อมูลต่อไปนี้:

### 1. Plans (3 แพ็กเกจ)

| Code | Name | Price/Month | Max Rooms | Max Users | Included Features |
|------|------|-------------|-----------|-----------|-------------------|
| S | Starter Plan | ฿990 | 20 | 3 | Basic Report |
| M | Medium Plan | ฿1,990 | 50 | 5 | Basic Report, Housekeeping |
| L | Large Plan | ฿3,990 | 100 | 10 | Basic Report, Housekeeping, Advanced Report |

### 2. Features (8 ฟีเจอร์เสริม)

| Code | Name | Type | Price/Month |
|------|------|------|-------------|
| `ota_booking` | OTA Booking Integration | MODULE | ฿500 |
| `automation` | Automation System | MODULE | ฿300 |
| `tax_invoice` | Tax Invoice | TOGGLE | ฿200 |
| `extra_user` | Extra User | LIMIT | ฿100 |
| `api_access` | API Access | MODULE | ฿400 |
| `advanced_report` | Advanced Report | MODULE | ฿250 |
| `housekeeping` | Housekeeping Management | TOGGLE | ฿150 |
| `basic_report` | Basic Report | TOGGLE | ฿0 |

### 3. Test User Accounts (สำหรับทดสอบ Login)

| Email | Password | Role | Description |
|-------|----------|------|-------------|
| `platform.admin@test.com` | `Admin@123` | `platform_admin` | SaaS Platform Admin (ดูแลทั้งระบบ) |
| `tenant.owner@test.com` | `Owner@123` | `tenant_admin` | Hotel Owner / Tenant Admin (เจ้าของโรงแรม) |
| `manager@test.com` | `Manager@123` | `manager` | Hotel Manager (ผู้จัดการโรงแรม) |
| `staff@test.com` | `Staff@123` | `staff` | Hotel Staff (พนักงาน) |
| `user@test.com` | `User@123` | `user` | Regular User (ผู้ใช้ทั่วไป) |

**ทดสอบ Login:**
```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tenant.owner@test.com",
    "password": "Owner@123"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "user": {
    "id": "...",
    "email": "tenant.owner@test.com",
    "firstName": "Hotel",
    "lastName": "Owner",
    "role": "tenant_admin"
  }
}
```

### 4. Sample Tenant (โรงแรมตัวอย่าง)

**Tenant:**
- Name: `โรงแรมตัวอย่าง (Sample Hotel)`
- Status: `trial`
- Trial Period: 14 วัน (จากวันที่รัน seed)

**Subscription:**
- Plan: `Starter Plan (S)`
- Status: `trial`
- Start Date: วันที่รัน seed
- End Date: วันที่รัน seed + 14 วัน
- Auto Renew: `false`

---

## 🧪 Testing Scenarios

### Scenario 0: ทดสอบ Authentication (Login/Register)

**ทดสอบ Login:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tenant.owner@test.com",
    "password": "Owner@123"
  }'
```

**Expected Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6...",
  "user": {
    "id": "uuid-here",
    "email": "tenant.owner@test.com",
    "firstName": "Hotel",
    "lastName": "Owner",
    "role": "tenant_admin"
  }
}
```

**ทดสอบ Register:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@test.com",
    "password": "NewUser@123",
    "firstName": "New",
    "lastName": "User"
  }'
```

**ทดสอบ Protected Endpoint (ต้องใช้ token):**

```bash
# ใช้ accessToken จาก login response
curl -X GET http://localhost:3001/api/v1/subscriptions \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**ทดสอบ Refresh Token:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

**ทดสอบ Logout:**

```bash
curl -X POST http://localhost:3001/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

### Scenario 1: ตรวจสอบ Subscription ปัจจุบัน

**ดู Subscription ทั้งหมด:**
```bash
curl http://localhost:3001/api/v1/subscriptions
```

**ดู Subscription ตาม Tenant ID:**

ก่อนอื่นต้องหา tenant ID ก่อน:
```bash
curl http://localhost:3001/api/v1/tenants
```

จากนั้นใช้ tenant ID เพื่อดู subscription:
```bash
curl http://localhost:3001/api/v1/subscriptions/tenant/{tenantId}
```

**Expected Response:**
```json
{
  "id": "...",
  "tenantId": "...",
  "planId": "...",
  "status": "trial",
  "startDate": "2026-01-24",
  "endDate": "2026-02-07",
  "autoRenew": false,
  "plan": {
    "code": "S",
    "name": "Starter Plan",
    "priceMonthly": 990,
    "maxRooms": 20,
    "maxUsers": 3
  },
  "subscriptionFeatures": []
}
```

### Scenario 2: ทดสอบ Subscription Active/Expired

**ตรวจสอบว่า Subscription ยังใช้งานได้:**

จาก subscription response ให้ตรวจสอบ:
- `status`: ต้องเป็น `"active"` หรือ `"trial"`
- `endDate`: ต้องมากกว่าวันปัจจุบัน

**วิธี Manual Update เพื่อทดสอบ Expiration:**

1. ดู subscription ID จาก API
2. Update endDate ให้เป็นอดีต:

```bash
curl -X PATCH http://localhost:3001/api/v1/subscriptions/{subscriptionId} \
  -H "Content-Type: application/json" \
  -d '{
    "endDate": "2026-01-20",
    "status": "expired"
  }'
```

3. ทดสอบว่าระบบตรวจจับได้ว่า subscription หมดอายุ

### Scenario 3: ทดสอบการต่ออายุ Subscription

**สร้าง Subscription ใหม่:**

```bash
curl -X POST http://localhost:3001/api/v1/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "{tenantId}",
    "planId": "{planId}",
    "status": "active",
    "startDate": "2026-01-24",
    "endDate": "2026-02-24",
    "autoRenew": true
  }'
```

### Scenario 4: ทดสอบ Upgrade Plan

**Upgrade จาก Plan S → Plan M:**

```bash
curl -X POST http://localhost:3001/api/v1/subscription-management/upgrade \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "{subscriptionId}",
    "newPlanId": "{planM_id}"
  }'
```

**Expected Response:**
```json
{
  "subscription": { ... },
  "proratedAmount": 450.25,
  "invoice": {
    "invoiceNo": "UPG-1234567890",
    "amount": 450.25,
    "status": "pending",
    "dueDate": "2026-01-24"
  }
}
```

### Scenario 5: ทดสอบ Add Feature

**เพิ่มฟีเจอร์ OTA Booking:**

```bash
curl -X POST http://localhost:3001/api/v1/subscription-management/add-feature \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "{subscriptionId}",
    "featureId": "{ota_booking_featureId}"
  }'
```

**Expected Response:**
```json
{
  "subscriptionFeature": {
    "id": "...",
    "subscriptionId": "...",
    "featureId": "...",
    "price": 500
  },
  "invoice": {
    "invoiceNo": "FEAT-1234567890",
    "amount": 500,
    "status": "pending"
  }
}
```

### Scenario 6: ทดสอบ Downgrade Plan

**Downgrade จาก Plan M → Plan S:**

```bash
curl -X POST http://localhost:3001/api/v1/subscription-management/downgrade \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "{subscriptionId}",
    "newPlanId": "{planS_id}"
  }'
```

**Expected Response:**
```json
{
  "subscription": { ... },
  "effectiveDate": "2026-02-24",
  "message": "Downgrade scheduled. Will take effect on subscription renewal."
}
```

---

## 📡 Complete API Reference

### Authentication APIs

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/v1/auth/register` | สมัครสมาชิกใหม่ | No |
| `POST` | `/api/v1/auth/login` | Login เข้าสู่ระบบ | No |
| `POST` | `/api/v1/auth/refresh` | Refresh access token | No |
| `POST` | `/api/v1/auth/logout` | Logout (revoke tokens) | Yes |

### Subscriptions APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/subscriptions` | ดู subscription ทั้งหมด |
| `GET` | `/api/v1/subscriptions/:id` | ดู subscription ตาม ID |
| `GET` | `/api/v1/subscriptions/tenant/:tenantId` | ดู subscription ตาม tenant ID |
| `POST` | `/api/v1/subscriptions` | สร้าง subscription ใหม่ |
| `PATCH` | `/api/v1/subscriptions/:id` | อัพเดท subscription |
| `DELETE` | `/api/v1/subscriptions/:id` | ลบ subscription |

### Subscription Management APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/subscription-management/upgrade` | Upgrade plan (มีผลทันที + prorate) |
| `POST` | `/api/v1/subscription-management/add-feature` | เพิ่มฟีเจอร์ (มีผลทันที) |
| `POST` | `/api/v1/subscription-management/downgrade` | Downgrade plan (มีผลรอบถัดไป) |

### Plans & Features APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/plans` | ดู plans ทั้งหมด |
| `GET` | `/api/v1/plans/:id` | ดู plan ตาม ID |
| `GET` | `/api/v1/features` | ดู features ทั้งหมด |
| `GET` | `/api/v1/features/:id` | ดู feature ตาม ID |

### Tenants APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/tenants` | ดู tenants ทั้งหมด |
| `GET` | `/api/v1/tenants/:id` | ดู tenant ตาม ID |
| `POST` | `/api/v1/tenants` | สร้าง tenant ใหม่ |

---

## ✅ Verify Results

### 1. ผ่าน API

**ตรวจสอบ Subscription Status:**
```bash
curl http://localhost:3001/api/v1/subscriptions
```

**ตรวจสอบ Plans:**
```bash
curl http://localhost:3001/api/v1/plans
```

**ตรวจสอบ Features:**
```bash
curl http://localhost:3001/api/v1/features
```

### 2. ผ่าน Swagger Documentation

เปิด browser ไปที่:
```
http://localhost:3001/api/docs
```

ที่นี่คุณสามารถ:
- ดู API endpoints ทั้งหมด
- ทดสอบ API ผ่าน interface
- ดู request/response schemas

### 3. ผ่าน phpMyAdmin (MAMP)

1. เปิด `http://localhost:8888/phpMyAdmin`
2. เลือก database `hotel_services_db`
3. ตรวจสอบ tables:
   - `subscriptions` - ดู subscription records
   - `plans` - ดู plan records
   - `features` - ดู feature records
   - `subscription_features` - ดูฟีเจอร์ที่เพิ่มใน subscription
   - `invoices` - ดู invoice records

### 4. ผ่าน MySQL CLI

```bash
mysql -u root -p -h localhost -P 8889

USE hotel_services_db;

-- ดู subscriptions
SELECT * FROM subscriptions;

-- ดู subscriptions พร้อม plan info
SELECT s.*, p.name, p.code, p.priceMonthly
FROM subscriptions s
JOIN plans p ON s.plan_id = p.id;

-- ดู expired subscriptions
SELECT * FROM subscriptions
WHERE endDate < CURDATE() OR status = 'expired';

-- ดู active subscriptions
SELECT * FROM subscriptions
WHERE endDate >= CURDATE() AND status IN ('active', 'trial');
```

---

## 🧮 Understanding Subscription Logic

### Subscription Status States

```
┌─────────┐
│  TRIAL  │ ← สถานะเริ่มต้นสำหรับทดลองใช้ (14 วัน)
└────┬────┘
     │
     ↓
┌─────────┐
│ PENDING │ ← รอชำระเงิน
└────┬────┘
     │
     ↓
┌─────────┐
│ ACTIVE  │ ← ใช้งานได้ปกติ
└────┬────┘
     │
     ↓
┌─────────┐
│ EXPIRED │ ← หมดอายุ (endDate < today)
└─────────┘
```

### Auto-Renewal Logic

```javascript
if (subscription.autoRenew === true && subscription.endDate < today) {
  // ต่ออายุอัตโนมัติ
  // สร้าง invoice ใหม่
  // ยืดระยะเวลา subscription อีก 30 วัน
}
```

### Proration Calculation (Upgrade)

```javascript
// เมื่อ upgrade จาก Plan S (990) → Plan M (1990)
// และเหลือเวลาอีก 15 วัน จากทั้งหมด 30 วัน

dailyOldPrice = 990 / 30 = 33 บาท/วัน
dailyNewPrice = 1990 / 30 = 66.33 บาท/วัน

remainingOldCost = 33 × 15 = 495 บาท
remainingNewCost = 66.33 × 15 = 995 บาท

proratedAmount = 995 - 495 = 500 บาท (ต้องจ่ายเพิ่มเติม)
```

---

## 🐛 Troubleshooting

### Error: Cannot connect to database

**สาเหตุ:**
- MAMP/MySQL ไม่ได้รัน
- Database configuration ไม่ถูกต้อง

**แก้ไข:**
```bash
# 1. ตรวจสอบ MAMP running
# 2. ตรวจสอบ .env file
cat .env

# 3. ตรวจสอบว่า database ถูกสร้างแล้ว
mysql -u root -p -h localhost -P 8889 -e "SHOW DATABASES;"
```

### Error: Database not found

**แก้ไข:**
```sql
CREATE DATABASE hotel_services_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

### Error: Access denied for user

**สาเหตุ:**
- Username/password ผิด
- Port ผิด (3306 vs 8889)

**แก้ไข:**
```bash
# ตรวจสอบ credentials ใน .env
DB_USERNAME=root
DB_PASSWORD=root
DB_PORT=8889
```

### Subscription ไม่ expire

**ตรวจสอบ:**
1. `endDate` ในฐานข้อมูล
2. Server timezone setting
3. Business logic ใน `SubscriptionsService.checkSubscriptionActive()`

**Debug:**
```bash
# ดู subscription ที่ควร expire แล้ว
mysql -u root -p -h localhost -P 8889 hotel_services_db

SELECT id, status, endDate,
       CURDATE() as today,
       DATEDIFF(endDate, CURDATE()) as days_remaining
FROM subscriptions;
```

### API ตอบกลับ 404 Not Found

**ตรวจสอบ:**
1. Server รันอยู่หรือไม่
2. URL ถูกต้องหรือไม่ (ต้องมี `/api/v1` prefix)
3. Port ถูกต้องหรือไม่ (default: 3001)

**ตัวอย่าง URL ที่ถูกต้อง:**
```
✅ http://localhost:3001/api/v1/subscriptions
❌ http://localhost:3001/subscriptions
❌ http://localhost:3000/api/v1/subscriptions
```

---

## 📝 Example Testing Flow

### Complete End-to-End Test

```bash
# 1. Setup database
npm run db:refresh

# 2. Start server
npm run start:dev

# 3. Test login
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tenant.owner@test.com",
    "password": "Owner@123"
  }' > login.json

# Extract access token (or copy from response)
ACCESS_TOKEN="..." # จาก login.json

# 4. Get all plans
curl http://localhost:3001/api/v1/plans > plans.json

# 4. Get all features
curl http://localhost:3001/api/v1/features > features.json

# 5. Get all tenants
curl http://localhost:3001/api/v1/tenants > tenants.json

# 6. Get subscriptions
curl http://localhost:3001/api/v1/subscriptions > subscriptions.json

# 7. Extract IDs from JSON (ใช้ jq หรืออ่านด้วยตา)
SUBSCRIPTION_ID="..." # จาก subscriptions.json
PLAN_M_ID="..."       # จาก plans.json (code: M)
FEATURE_OTA_ID="..."  # จาก features.json (code: ota_booking)

# 8. Test upgrade
curl -X POST http://localhost:3001/api/v1/subscription-management/upgrade \
  -H "Content-Type: application/json" \
  -d "{
    \"subscriptionId\": \"$SUBSCRIPTION_ID\",
    \"newPlanId\": \"$PLAN_M_ID\"
  }"

# 9. Test add feature
curl -X POST http://localhost:3001/api/v1/subscription-management/add-feature \
  -H "Content-Type: application/json" \
  -d "{
    \"subscriptionId\": \"$SUBSCRIPTION_ID\",
    \"featureId\": \"$FEATURE_OTA_ID\"
  }"

# 10. Verify final state
curl http://localhost:3001/api/v1/subscriptions/$SUBSCRIPTION_ID

# 11. Test expiration (manual update)
curl -X PATCH http://localhost:3001/api/v1/subscriptions/$SUBSCRIPTION_ID \
  -H "Content-Type: application/json" \
  -d '{
    "endDate": "2026-01-20",
    "status": "expired"
  }'

# 12. Verify expired state
curl http://localhost:3001/api/v1/subscriptions/$SUBSCRIPTION_ID
```

---

## 🎯 Testing Checklist

### Database Setup
- [ ] Run `npm run db:refresh` successfully
- [ ] Verify 3 plans created (S, M, L)
- [ ] Verify 8 features created
- [ ] Verify 5 test users created (all roles)
- [ ] Verify sample tenant created with trial subscription

### Server
- [ ] Start server with `npm run start:dev`
- [ ] API accessible at `http://localhost:3001`
- [ ] Swagger docs accessible at `http://localhost:3001/api/docs`

### Authentication
- [ ] Login with test accounts (all 5 roles)
- [ ] Register new user
- [ ] Access protected endpoints with token
- [ ] Refresh access token
- [ ] Logout and revoke tokens

### Subscription CRUD
- [ ] Get all subscriptions
- [ ] Get subscription by ID
- [ ] Get subscription by tenant ID
- [ ] Create new subscription
- [ ] Update subscription
- [ ] Delete subscription

### Subscription Management
- [ ] Upgrade plan (verify proration calculation)
- [ ] Downgrade plan (verify scheduled for next renewal)
- [ ] Add feature (verify immediate activation)
- [ ] Verify invoice created for each transaction

### Expiration Testing
- [ ] Verify trial subscription expires after 14 days
- [ ] Manually set endDate to past and verify expired status
- [ ] Test auto-renewal logic (if implemented)
- [ ] Test subscription deactivation after expiration

### Data Verification
- [ ] Check database via phpMyAdmin
- [ ] Verify subscription status changes
- [ ] Verify invoice records
- [ ] Verify subscription_features records

---

## 🎉 Success Criteria

คุณจะรู้ว่าทดสอบสำเร็จเมื่อ:

1. ✅ Database setup และ seed สำเร็จ (รวม 5 test users)
2. ✅ Server รันได้และตอบกลับ API requests
3. ✅ สามารถ Login/Register/Logout ได้ถูกต้อง
4. ✅ Token authentication ทำงานถูกต้อง
5. ✅ สามารถดู/สร้าง/แก้ไข/ลบ subscriptions ได้
6. ✅ Upgrade/downgrade/add feature ทำงานถูกต้อง
7. ✅ Proration calculation ถูกต้อง
8. ✅ Subscription expiration ตรวจจับได้
9. ✅ ข้อมูลในฐานข้อมูลสอดคล้องกับ API responses

---

## 📚 Additional Resources

- **Main Quick Start Guide:** [QUICK_START.md](./QUICK_START.md)
- **Seeder Documentation:** [SEEDER.md](./SEEDER.md)
- **API Integration Guide:** [FRONTEND_API_INTEGRATION.md](./FRONTEND_API_INTEGRATION.md)
- **Troubleshooting Guide:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Swagger API Docs:** http://localhost:3001/api/docs

---

## 💡 Tips & Best Practices

### 1. Use Postman/Insomnia Collections

สร้าง collection สำหรับ API testing:
- แยก folder ตาม module (Subscriptions, Plans, Features)
- เก็บ environment variables (IDs, tokens)
- Share กับทีมเพื่อ consistency

### 2. Automate with Scripts

สร้าง test script:
```bash
#!/bin/bash
# test-subscription.sh

echo "🧪 Starting Subscription Tests..."

# Setup
npm run db:refresh
npm run start:dev &
sleep 5

# Run tests
./scripts/test-subscription-crud.sh
./scripts/test-subscription-upgrade.sh
./scripts/test-subscription-expiration.sh

# Cleanup
killall node

echo "✅ Tests completed!"
```

### 3. Monitor Logs

```bash
# Watch server logs
npm run start:dev | tee server.log

# Filter for subscription-related logs
tail -f server.log | grep -i subscription
```

### 4. Database Snapshots

```bash
# Backup before testing
mysqldump -u root -p hotel_services_db > backup.sql

# Restore if needed
mysql -u root -p hotel_services_db < backup.sql
```

---

**Happy Testing! 🚀**

เอกสารนี้จะช่วยให้คุณสามารถทดสอบ Subscription Expiration และฟีเจอร์ที่เกี่ยวข้องได้อย่างรวดเร็วและครบถ้วน

หากพบปัญหาหรือมีคำถาม กรุณาดูที่ [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) หรือติดต่อทีม Dev
