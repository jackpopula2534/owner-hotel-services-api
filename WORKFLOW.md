# 🧱 SaaS Workflow Documentation

## โครงสร้างภาพรวม (SaaS Layer)

ระบบออกแบบเป็น 2 โลกซ้อนกัน:

```
[ SaaS Platform ]
  ├─ Auth / Account
  ├─ Plan / Billing
  ├─ Subscription
  ├─ Payment
  ├─ Feature Flag
  ├─ Admin Panel
  └─ Tenant Provisioning
        ↓
[ Hotel PMS (Tenant) ]
```

**SaaS = คุมสิทธิ์ + เงิน + เวลาใช้งาน**  
**PMS = ทำงานโรงแรม**

---

## 🔁 Complete Workflow

### 1️⃣ Owner สมัครใช้งาน (Onboarding)

**Flow:**
```
Owner สมัคร Account
  → สร้าง Hotel (tenant)
  → ระบบสร้าง tenant_id, hotel schema/data
  → สถานะ → trial
```

**API:**
```http
POST /onboarding/register
{
  "name": "โรงแรม ABC",
  "roomCount": 30
}
```

**Response:**
- สร้าง `tenant` (status: trial)
- สร้าง `subscription` (status: trial, plan: S)
- ตั้ง `trialEndsAt` (14 วัน)
- 📌 ยังเข้า PMS ได้ แต่โดนจำกัด

---

### 2️⃣ Trial System (โคตรสำคัญ)

**แนะนำ:**
- Trial 7 / 14 วัน
- จำกัด:
  - จำนวน booking
  - OTA ไม่เปิด
  - Report บางส่วน

**Flow:**
```
Login → เข้า PMS ได้ทันที
Banner เตือน: "เหลือเวลาใช้งาน 5 วัน"
```

**API:**
```http
GET /onboarding/tenant/:tenantId/trial-status
```

**Response:**
```json
{
  "isTrial": true,
  "daysRemaining": 5,
  "trialEndsAt": "2024-01-15T00:00:00Z",
  "canAccessPMS": true
}
```

**📌 โรงแรมต้อง "ลองใช้จริง" ก่อนกล้าจ่าย**

---

### 3️⃣ เลือก Plan (รายเดือน)

**Plan Structure:**
- Base Plan = สิทธิ์เข้า PMS
- คิดตามจำนวนห้อง
- ตัวอย่าง: S / M / L

**Plan กำหนด:**
- `max_rooms`
- `max_users`
- `base_features[]`

**API:**
```http
GET /plans
GET /plans/code/S
```

---

### 4️⃣ Custom Functions (Add-on System)

**Feature Catalog:**
- แต่ละฟีเจอร์ต้องเป็น entity
- `features.code` ห้ามเปลี่ยน (ใช้ผูก logic)

**ตัวอย่าง:**
- `ota_booking` - OTA Booking.com
- `automation` - Automation
- `tax_invoice` - Tax Invoice
- `extra_user` - Extra User
- `api_access` - API Access

**Owner เลือก:**
- Plan หลัก
- Add-on

**📌 Feature Flag ต้องทำตั้งแต่วันแรก**

---

### 5️⃣ Billing Cycle (หัวใจ SaaS)

**เมื่อกด "ซื้อ":**
```
สร้าง Invoice
  → สถานะ → pending
  → แสดง: ยอด, รอบบิล, วันหมดอายุ
```

**Payment Methods:**
- โอน
- QR
- (Card ไว้ทีหลัง)

**Owner อัปโหลดสลิป:**
```http
POST /payments
{
  "invoiceId": "...",
  "method": "transfer",
  "slipUrl": "https://..."
}
```

---

### 6️⃣ Admin Approval Flow

**ฝั่ง Admin เห็น:**
- Invoice list
- Slip
- Hotel
- Plan + Add-on

**Admin กด:**
- Approve
- Reject (ใส่ reason)

**เมื่อ Approve:**
```
ระบบทำ:
  → invoice → paid
  → subscription → active
  → set: start_date, end_date
  → unlock features
  → extend usage days
```

**📌 วันใช้งานต้องคำนวณจาก approve จริง**

**API:**
```http
POST /admin-approval/payments/:paymentId/approve
{
  "adminId": "..."
}
```

---

### 7️⃣ Subscription Runtime (ตอนใช้งานจริง)

**ทุก request เข้า PMS ต้องผ่าน middleware:**
```
เช็ก:
  → subscription active?
  → today <= end_date?
  → feature enabled?
```

**ถ้าหมด:**
- ❌ อย่าล็อกทันทีแบบโหด
- ✔️ ให้ดูข้อมูลได้ แต่ทำอะไรไม่ได้ (Read-only)
- Block create booking
- แจ้งเตือน

**Guard Usage:**
```typescript
@UseGuards(SubscriptionGuard)
@Get('bookings')
async getBookings(@Request() req) {
  // req.subscriptionAccessMode = 'read_only' | 'full_access' | 'blocked'
}
```

---

### 8️⃣ ต่ออายุ / Upgrade / Downgrade

**Owner ทำเองได้:**

**Upgrade plan:**
```http
POST /subscription-management/upgrade
{
  "subscriptionId": "...",
  "newPlanId": "..."
}
```
- → prorate (คำนวณส่วนต่าง)

**Add feature:**
```http
POST /subscription-management/add-feature
{
  "subscriptionId": "...",
  "featureId": "..."
}
```
- → immediate (ใช้งานได้ทันที)

**Downgrade:**
```http
POST /subscription-management/downgrade
{
  "subscriptionId": "...",
  "newPlanId": "..."
}
```
- → มีผลรอบหน้า

**📌 ทำให้ owner คุมค่าใช้จ่ายเอง = ลด support**

---

### 9️⃣ SaaS Admin Panel

**Admin ควรเห็น:**
- Hotel ทั้งหมด
- Trial / Active / Expired
- Revenue รายเดือน
- Feature usage
- Payment pending

**API:**
```http
GET /admin-panel/dashboard
GET /admin-panel/hotels
GET /admin-panel/pending-payments
```

**📌 SaaS ที่ไม่มี admin panel = เหนื่อยชิบหาย**

---

## 🧠 Key Design Decisions

1. **SaaS แยกจาก PMS ให้ชัด**
   - Feature = Toggle
   - Subscription = Time-based
   - Admin = คนคุมเงินจริง

2. **Trial System**
   - ยังเข้า PMS ได้ แต่จำกัด features
   - Banner เตือนวันเหลือ

3. **Payment Flow**
   - เงินยังไม่ใช่เงิน จน admin approve
   - วันใช้งานคำนวณจาก approve จริง

4. **Subscription Expiry**
   - อย่าล็อกทันที
   - ให้ดูข้อมูลได้ (Read-only)
   - Block create/update

5. **Feature Flag**
   - ตรวจสอบทุก request
   - Trial จำกัด features บางตัว
   - Hardcode feature code ใน logic

---

## 📊 Database Flow

```
Tenant สมัคร
  → Trial Subscription
  → เลือก Plan + Feature
  → Invoice (pending)
  → Upload Slip
  → Admin Approve
  → Subscription Active
  → Features Unlocked
```

---

## 🔐 Feature Flag Logic

**เวลา PMS เรียก API:**
```
tenant
  → subscription active?
  → today <= end_date?
  → feature enabled?
```

**ถ้าไม่ผ่าน:**
- 403 + message
- UI disable ปุ่ม

**Trial Mode:**
- จำกัด: `ota_booking`, `advanced_report`
- ใช้งานได้: `basic_report`, `booking`, etc.

---

## 🎯 API Endpoints Summary

### Onboarding
- `POST /onboarding/register` - สมัครโรงแรม
- `GET /onboarding/tenant/:id/trial-status` - ตรวจสอบ trial

### Subscription Management
- `POST /subscription-management/upgrade` - Upgrade plan
- `POST /subscription-management/add-feature` - เพิ่ม feature
- `POST /subscription-management/downgrade` - Downgrade plan

### Admin Approval
- `POST /admin-approval/payments/:id/approve` - Approve payment
- `POST /admin-approval/payments/:id/reject` - Reject payment
- `GET /admin-approval/pending-payments` - รายการ pending

### Admin Panel
- `GET /admin-panel/dashboard` - Dashboard
- `GET /admin-panel/hotels` - รายการโรงแรม
- `GET /admin-panel/pending-payments` - Payment pending

### Feature Access
- `GET /feature-access/check?tenantId=xxx&featureCode=ota_booking` - ตรวจสอบ feature
- `GET /feature-access/tenant/:id/features` - Features ทั้งหมด
- `GET /feature-access/tenant/:id/subscription-status` - Subscription status

---

## 🚀 Next Steps

1. ✅ Onboarding Service
2. ✅ Trial System
3. ✅ Subscription Guard
4. ✅ Admin Approval
5. ✅ Upgrade/Downgrade
6. ✅ Admin Panel
7. ⏳ Authentication/Authorization
8. ⏳ Seed Data
9. ⏳ Migration Files


