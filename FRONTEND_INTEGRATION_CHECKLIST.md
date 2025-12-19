# ✅ Frontend Integration Checklist - รายการตรวจสอบการเชื่อมต่อ Backend

เอกสารนี้เป็นรายการตรวจสอบครบถ้วนสำหรับทีม Frontend เพื่อเชื่อมต่อกับระบบ Backend ทั้งหมด

**อัปเดตล่าสุด:** 2024-12-14  
**Backend Version:** v1  
**Base URL:** `http://localhost:3001/api/v1` (dev) หรือ `https://api.yourdomain.com/api/v1` (production)

---

## 📋 สารบัญ

1. [การตั้งค่าเบื้องต้น](#1-การตั้งค่าเบื้องต้น)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [Core Hotel Management Modules](#3-core-hotel-management-modules)
4. [SaaS/Subscription Management Modules](#4-saassubscription-management-modules)
5. [Admin Panel & Platform Management](#5-admin-panel--platform-management)
6. [Error Handling & Status Codes](#6-error-handling--status-codes)
7. [Testing Checklist](#7-testing-checklist)

---

## 1. การตั้งค่าเบื้องต้น

### ✅ 1.1 Environment Variables

Frontend ต้องตั้งค่า environment variables:

```env
# .env.local หรือ .env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

### ✅ 1.2 API Client Setup

สร้าง API client ที่รองรับ:
- ✅ Base URL configuration
- ✅ Automatic token injection (`Authorization: Bearer <token>`)
- ✅ Token refresh mechanism
- ✅ Error handling (401, 403, 429)
- ✅ Request/Response interceptors

**ตัวอย่างโครงสร้าง:**
```typescript
// lib/api-client.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

// ต้องรองรับ:
// - Auto-inject Authorization header
// - Handle 401 → refresh token → retry
// - Handle 403 → show permission error
// - Handle 429 → show rate limit error
```

### ✅ 1.3 CORS Configuration

Backend ตั้งค่า CORS แล้ว:
- ✅ Origin: `http://localhost:3000` (dev) หรือจาก `FRONTEND_URL` env
- ✅ Credentials: `true`
- ✅ Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- ✅ Headers: Content-Type, Authorization

---

## 2. Authentication & Authorization

### ✅ 2.1 Authentication Endpoints

| Method | Endpoint | Public | Rate Limit | Description |
|--------|----------|--------|------------|-------------|
| `POST` | `/api/v1/auth/register` | ✅ | 5/60s | สมัครสมาชิกใหม่ |
| `POST` | `/api/v1/auth/login` | ✅ | 10/60s | เข้าสู่ระบบ |
| `POST` | `/api/v1/auth/refresh` | ✅ | 30/60s | Refresh access token |
| `POST` | `/api/v1/auth/logout` | ❌ | 100/60s | ออกจากระบบ |

**Frontend ต้องทำ:**
- ✅ เก็บ `accessToken` และ `refreshToken` หลัง login/register
- ✅ เก็บข้อมูล `user` (รวม `role`, `userId`, `tenantId`)
- ✅ ส่ง `Authorization: Bearer <accessToken>` ทุก request (ยกเว้น public endpoints)
- ✅ Handle token refresh เมื่อได้ 401
- ✅ Redirect ไปหน้า login เมื่อ refresh token หมดอายุ

**Response Format:**
```typescript
// POST /auth/login
{
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: 'platform_admin' | 'tenant_admin' | 'manager' | 'staff' | 'user';
    tenantId?: string;
    // ... other user fields
  }
}
```

### ✅ 2.2 Role-Based Access Control (RBAC)

**Roles ที่มี:**
- `platform_admin` - SaaS platform admin (ดูแลทั้งระบบ)
- `tenant_admin` - เจ้าของโรงแรม / ผู้ซื้อ subscription
- `manager` - ผู้จัดการโรงแรม
- `staff` - พนักงาน (แม่บ้าน, เสิร์ฟ, ช่างซ่อม)
- `user` - ผู้ใช้ทั่วไป
- `admin` - legacy alias (ยังรองรับ)

**Frontend ต้องทำ:**
- ✅ ตรวจสอบ `user.role` จาก JWT payload
- ✅ แสดง/ซ่อนเมนูตาม role
- ✅ ป้องกันการเข้าถึงหน้าจอที่ไม่มีสิทธิ์
- ✅ Handle 403 Forbidden response

**ตัวอย่างการใช้งาน:**
```typescript
// lib/auth.ts
export const hasRole = (user: User, roles: string[]) => {
  return roles.includes(user.role);
};

// components/ProtectedRoute.tsx
if (!hasRole(user, ['admin', 'manager'])) {
  return <AccessDenied />;
}
```

---

## 3. Core Hotel Management Modules

### ✅ 3.1 Guests Module

**Base Path:** `/api/v1/guests`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/guests` | admin, manager | รายการแขก (รองรับ query: page, limit, search) |
| `GET` | `/guests/:id` | admin, manager | ข้อมูลแขก |
| `POST` | `/guests` | admin, manager | สร้างแขกใหม่ |
| `PUT` | `/guests/:id` | admin, manager | แก้ไขข้อมูลแขก |
| `DELETE` | `/guests/:id` | admin | ลบแขก |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการแขก (Guest Management)
- ✅ ฟอร์มสร้าง/แก้ไขแขก
- ✅ Search & Filter
- ✅ Pagination

### ✅ 3.2 Bookings Module

**Base Path:** `/api/v1/bookings`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/bookings` | admin, manager | รายการจอง (รองรับ query: page, limit, search, status) |
| `GET` | `/bookings/:id` | admin, manager | ข้อมูลการจอง |
| `POST` | `/bookings` | admin, manager | สร้างการจองใหม่ |
| `PUT` | `/bookings/:id` | admin, manager | แก้ไขการจอง |
| `DELETE` | `/bookings/:id` | admin, manager | ยกเลิกการจอง |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการการจอง (Booking Management)
- ✅ ฟอร์มสร้าง/แก้ไขการจอง
- ✅ แสดงสถานะการจอง (pending, confirmed, checked-in, checked-out, cancelled)
- ✅ Calendar view สำหรับดูการจอง
- ✅ Search & Filter

### ✅ 3.3 Rooms Module

**Base Path:** `/api/v1/rooms`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/rooms` | admin, manager | รายการห้อง (รองรับ query: page, limit, search, floor, type) |
| `GET` | `/rooms/available` | admin, manager | ห้องว่าง (query: checkIn, checkOut) |
| `GET` | `/rooms/:id` | admin, manager | ข้อมูลห้อง |
| `POST` | `/rooms` | admin | สร้างห้องใหม่ |
| `PATCH` | `/rooms/:id` | admin | แก้ไขข้อมูลห้อง |
| `PATCH` | `/rooms/:id/status` | admin, manager | อัปเดตสถานะห้อง |
| `DELETE` | `/rooms/:id` | admin | ลบห้อง |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการห้อง (Room Management)
- ✅ ฟอร์มสร้าง/แก้ไขห้อง
- ✅ หน้าค้นหาห้องว่าง (Available Rooms)
- ✅ แสดงสถานะห้อง (available, occupied, maintenance, cleaning)
- ✅ Floor plan view (ถ้ามี)

### ✅ 3.4 Restaurant Module

**Base Path:** `/api/v1/restaurant`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/restaurant` | admin, manager | รายการเมนู (รองรับ query: page, limit, search) |
| `GET` | `/restaurant/:id` | admin, manager | ข้อมูลเมนู |
| `POST` | `/restaurant` | admin | สร้างเมนูใหม่ |
| `PATCH` | `/restaurant/:id` | admin | แก้ไขเมนู |
| `DELETE` | `/restaurant/:id` | admin | ลบเมนู |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการเมนู (Restaurant Menu Management)
- ✅ ฟอร์มสร้าง/แก้ไขเมนู
- ✅ แสดงรูปภาพเมนู
- ✅ Search & Filter

### ✅ 3.5 HR Module (Employees)

**Base Path:** `/api/v1/hr`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/hr` | admin, manager | รายการพนักงาน (รองรับ query: page, limit, search, department, position) |
| `GET` | `/hr/:id` | admin, manager | ข้อมูลพนักงาน |
| `POST` | `/hr` | admin | สร้างพนักงานใหม่ |
| `PATCH` | `/hr/:id` | admin | แก้ไขข้อมูลพนักงาน |
| `DELETE` | `/hr/:id` | admin | ลบพนักงาน |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการพนักงาน (HR Management)
- ✅ ฟอร์มสร้าง/แก้ไขพนักงาน
- ✅ Filter ตาม department และ position
- ✅ Search & Pagination

### ✅ 3.6 Channels Module (OTA Integration)

**Base Path:** `/api/v1/channels`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/channels` | admin, manager | รายการช่องทางการจอง (รองรับ query: page, limit, search) |
| `GET` | `/channels/:id` | admin, manager | ข้อมูลช่องทาง |
| `POST` | `/channels` | admin | สร้างช่องทางใหม่ |
| `PATCH` | `/channels/:id` | admin | แก้ไขช่องทาง |
| `POST` | `/channels/:id/sync` | admin, manager | ซิงค์ข้อมูลจากช่องทาง |
| `PATCH` | `/channels/:id/toggle-active` | admin | เปิด/ปิดช่องทาง |
| `DELETE` | `/channels/:id` | admin | ลบช่องทาง |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการช่องทาง (Channel Management)
- ✅ ฟอร์มสร้าง/แก้ไขช่องทาง (OTA: Booking.com, Agoda, Expedia, etc.)
- ✅ ปุ่ม Sync สำหรับดึงข้อมูลจาก OTA
- ✅ Toggle active/inactive
- ✅ แสดงสถานะการเชื่อมต่อ

### ✅ 3.7 Reviews Module

**Base Path:** `/api/v1/reviews`

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/reviews` | admin, manager | รายการรีวิว (รองรับ query: page, limit, search, rating) |
| `GET` | `/reviews/stats` | admin, manager | สถิติรีวิว (average rating, count, distribution) |
| `GET` | `/reviews/qr/:code` | admin, manager | ดึงรีวิวจาก QR code |
| `GET` | `/reviews/booking/:bookingId` | admin, manager | ดึงรีวิวจาก booking ID |
| `GET` | `/reviews/:id` | admin, manager | ข้อมูลรีวิว |
| `POST` | `/reviews` | admin, manager | สร้างรีวิวใหม่ |
| `POST` | `/reviews/qr/generate` | admin, manager | สร้าง QR code สำหรับรีวิว |
| `PATCH` | `/reviews/:id` | admin, manager | แก้ไขรีวิว |
| `DELETE` | `/reviews/:id` | admin | ลบรีวิว |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการรีวิว (Review Management)
- ✅ หน้าสถิติรีวิว (Review Statistics Dashboard)
- ✅ แสดง rating distribution (1-5 stars)
- ✅ ฟังก์ชันสร้าง QR code สำหรับรีวิว
- ✅ Scan QR code เพื่อดูรีวิว
- ✅ Search & Filter

---

## 4. SaaS/Subscription Management Modules

### ✅ 4.1 Onboarding Module

**Base Path:** `/api/onboarding` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Public | Description |
|--------|----------|--------|-------------|
| `POST` | `/onboarding/register` | ✅ | สมัครโรงแรมใหม่ (สร้าง tenant + trial subscription) |
| `GET` | `/onboarding/tenant/:tenantId/trial-status` | ❌ | ตรวจสอบสถานะ trial |

**Frontend ต้องทำ:**
- ✅ หน้าสมัครโรงแรม (Hotel Registration)
- ✅ ฟอร์มกรอกข้อมูลโรงแรม
- ✅ แสดง trial status และวันหมดอายุ
- ✅ แจ้งเตือนเมื่อ trial ใกล้หมดอายุ

**Request Format:**
```typescript
// POST /onboarding/register
{
  name: string;           // ชื่อโรงแรม
  email: string;          // Email เจ้าของ
  phone?: string;
  address?: string;
  trialDays?: number;     // Default: 14
  // ... other hotel fields
}
```

### ✅ 4.2 Tenants Module (Hotel Management)

**Base Path:** `/api/tenants` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `POST` | `/tenants/hotels` | platform_admin | สร้างโรงแรมใหม่ |
| `GET` | `/tenants/hotels` | platform_admin | รายการโรงแรมทั้งหมด (รองรับ search, filter, pagination) |
| `GET` | `/tenants/hotels/:id` | platform_admin | ข้อมูลรายละเอียดโรงแรม (รวม subscription, plan, features, invoices) |
| `GET` | `/tenants` | platform_admin | รายการ tenants (legacy) |
| `GET` | `/tenants/:id` | platform_admin | ข้อมูล tenant (legacy) |
| `PATCH` | `/tenants/:id` | platform_admin | แก้ไข tenant |
| `DELETE` | `/tenants/:id` | platform_admin | ลบ tenant |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการโรงแรม (Hotel Management - สำหรับ Platform Admin)
- ✅ ฟอร์มสร้าง/แก้ไขโรงแรม
- ✅ หน้าดูรายละเอียดโรงแรม (รวม subscription status, plan, features, invoices)
- ✅ Search & Filter

### ✅ 4.3 Plans Module

**Base Path:** `/api/plans` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/plans` | Public/Admin | รายการ subscription plans |
| `GET` | `/plans/:id` | Public/Admin | ข้อมูล plan |
| `GET` | `/plans/code/:code` | Public/Admin | ข้อมูล plan จาก code |
| `POST` | `/plans` | platform_admin | สร้าง plan ใหม่ |
| `PATCH` | `/plans/:id` | platform_admin | แก้ไข plan |
| `DELETE` | `/plans/:id` | platform_admin | ลบ plan |

**Frontend ต้องทำ:**
- ✅ หน้าแสดง subscription plans (Pricing Page)
- ✅ เปรียบเทียบ plans
- ✅ หน้าจัดการ plans (สำหรับ Platform Admin)

### ✅ 4.4 Features Module

**Base Path:** `/api/features` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/features` | Public/Admin | รายการ features ทั้งหมด |
| `GET` | `/features/:id` | Public/Admin | ข้อมูล feature |
| `GET` | `/features/code/:code` | Public/Admin | ข้อมูล feature จาก code |
| `POST` | `/features` | platform_admin | สร้าง feature ใหม่ |
| `PATCH` | `/features/:id` | platform_admin | แก้ไข feature |
| `DELETE` | `/features/:id` | platform_admin | ลบ feature |

**Frontend ต้องทำ:**
- ✅ หน้าแสดง features (Feature List)
- ✅ หน้าจัดการ features (สำหรับ Platform Admin)

### ✅ 4.5 Subscriptions Module

**Base Path:** `/api/subscriptions` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/subscriptions` | platform_admin | รายการ subscriptions ทั้งหมด |
| `GET` | `/subscriptions/:id` | platform_admin, tenant_admin | ข้อมูล subscription |
| `GET` | `/subscriptions/tenant/:tenantId` | platform_admin, tenant_admin | ข้อมูล subscription ของ tenant |
| `POST` | `/subscriptions` | platform_admin | สร้าง subscription ใหม่ |
| `PATCH` | `/subscriptions/:id` | platform_admin | แก้ไข subscription |
| `DELETE` | `/subscriptions/:id` | platform_admin | ลบ subscription |

**Frontend ต้องทำ:**
- ✅ หน้าดู subscription ของโรงแรม (สำหรับ Tenant Admin)
- ✅ หน้าจัดการ subscriptions (สำหรับ Platform Admin)
- ✅ แสดงสถานะ subscription (active, expired, cancelled, trial)
- ✅ แสดงวันหมดอายุ

### ✅ 4.6 Subscription Management Module

**Base Path:** `/api/subscription-management` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `POST` | `/subscription-management/upgrade` | tenant_admin | อัปเกรด plan |
| `POST` | `/subscription-management/add-feature` | tenant_admin | เพิ่ม feature |
| `POST` | `/subscription-management/downgrade` | tenant_admin | Downgrade plan |

**Frontend ต้องทำ:**
- ✅ หน้าอัปเกรด plan (Upgrade Plan)
- ✅ หน้าเพิ่ม features (Add Features)
- ✅ หน้า downgrade plan (Downgrade Plan)
- ✅ แสดง confirmation dialog ก่อนทำการเปลี่ยนแปลง

**Request Format:**
```typescript
// POST /subscription-management/upgrade
{
  subscriptionId: string;
  newPlanId: string;
}

// POST /subscription-management/add-feature
{
  subscriptionId: string;
  featureId: string;
}

// POST /subscription-management/downgrade
{
  subscriptionId: string;
  newPlanId: string;
}
```

### ✅ 4.7 Feature Access Module

**Base Path:** `/api/feature-access` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/feature-access/check` | tenant_admin, manager | ตรวจสอบสิทธิ์ใช้ feature (query: tenantId, featureCode) |
| `GET` | `/feature-access/tenant/:tenantId/features` | tenant_admin, manager | รายการ features ที่ tenant มีสิทธิ์ใช้ |
| `GET` | `/feature-access/tenant/:tenantId/subscription-status` | tenant_admin, manager | สถานะ subscription ของ tenant |

**Frontend ต้องทำ:**
- ✅ ตรวจสอบสิทธิ์ก่อนแสดง features/ฟีเจอร์
- ✅ ซ่อนเมนู/ฟังก์ชันที่ไม่มีสิทธิ์
- ✅ แสดงข้อความเมื่อพยายามเข้าถึง feature ที่ไม่มีสิทธิ์

**ตัวอย่างการใช้งาน:**
```typescript
// lib/feature-access.ts
const hasFeatureAccess = async (tenantId: string, featureCode: string) => {
  const response = await api.get('/feature-access/check', {
    params: { tenantId, featureCode }
  });
  return response.data.hasAccess;
};

// components/FeatureGate.tsx
if (!await hasFeatureAccess(tenantId, 'ota_booking')) {
  return <FeatureLocked />;
}
```

### ✅ 4.8 Invoices Module

**Base Path:** `/api/invoices` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/invoices` | platform_admin | รายการ invoices ทั้งหมด |
| `GET` | `/invoices/:id` | platform_admin, tenant_admin | ข้อมูล invoice |
| `GET` | `/invoices/tenant/:tenantId` | platform_admin, tenant_admin | รายการ invoices ของ tenant |
| `POST` | `/invoices` | platform_admin | สร้าง invoice ใหม่ |
| `PATCH` | `/invoices/:id` | platform_admin | แก้ไข invoice |
| `DELETE` | `/invoices/:id` | platform_admin | ลบ invoice |

**Frontend ต้องทำ:**
- ✅ หน้าดู invoices ของโรงแรม (สำหรับ Tenant Admin)
- ✅ หน้าจัดการ invoices (สำหรับ Platform Admin)
- ✅ แสดงสถานะ invoice (draft, sent, paid, overdue, cancelled)
- ✅ Download/Print invoice

### ✅ 4.9 Payments Module

**Base Path:** `/api/payments` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/payments` | platform_admin | รายการ payments ทั้งหมด |
| `GET` | `/payments/:id` | platform_admin, tenant_admin | ข้อมูล payment |
| `GET` | `/payments/invoice/:invoiceId` | platform_admin, tenant_admin | รายการ payments ของ invoice |
| `POST` | `/payments` | tenant_admin | สร้าง payment (upload slip) |
| `POST` | `/payments/:id/approve` | platform_admin | อนุมัติ payment |
| `POST` | `/payments/:id/reject` | platform_admin | ปฏิเสธ payment |
| `PATCH` | `/payments/:id` | platform_admin | แก้ไข payment |
| `DELETE` | `/payments/:id` | platform_admin | ลบ payment |

**Frontend ต้องทำ:**
- ✅ หน้าอัปโหลดสลิปการโอนเงิน (สำหรับ Tenant Admin)
- ✅ หน้าดูสถานะ payment
- ✅ หน้าจัดการ payments (สำหรับ Platform Admin)
- ✅ หน้าอนุมัติ/ปฏิเสธ payment
- ✅ แสดงสถานะ payment (pending, approved, rejected)

### ✅ 4.10 Admin Approval Module

**Base Path:** `/api/admin-approval` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/admin-approval/pending-payments` | platform_admin | รายการ payments ที่รออนุมัติ |
| `POST` | `/admin-approval/payments/:paymentId/approve` | platform_admin | อนุมัติ payment |
| `POST` | `/admin-approval/payments/:paymentId/reject` | platform_admin | ปฏิเสธ payment |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการการอนุมัติ (Approval Dashboard - สำหรับ Platform Admin)
- ✅ แสดงรายการ payments ที่รออนุมัติ
- ✅ ฟอร์มอนุมัติ/ปฏิเสธพร้อมเหตุผล

---

## 5. Admin Panel & Platform Management

### ✅ 5.1 Admin Panel Module

**Base Path:** `/api/admin-panel` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/admin-panel/dashboard` | platform_admin | Dashboard สำหรับ Platform Admin (รวมสถิติทั้งหมด) |
| `GET` | `/admin-panel/hotels` | platform_admin | รายการโรงแรมทั้งหมด (พร้อม subscription status) |
| `GET` | `/admin-panel/pending-payments` | platform_admin | รายการ payments ที่รออนุมัติ (พร้อมรายละเอียด) |

**Frontend ต้องทำ:**
- ✅ หน้า Dashboard สำหรับ Platform Admin
- ✅ แสดงสถิติ: จำนวนโรงแรม, subscriptions, revenue, pending payments
- ✅ Charts/Graphs สำหรับ visualization
- ✅ Quick actions: approve payments, view hotels

### ✅ 5.2 Admins Module

**Base Path:** `/api/admins` (⚠️ ไม่มี version prefix)

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `GET` | `/admins` | platform_admin | รายการ platform admins |
| `GET` | `/admins/:id` | platform_admin | ข้อมูล admin |
| `POST` | `/admins` | platform_admin | สร้าง admin ใหม่ |
| `PATCH` | `/admins/:id` | platform_admin | แก้ไข admin |
| `DELETE` | `/admins/:id` | platform_admin | ลบ admin |

**Frontend ต้องทำ:**
- ✅ หน้าจัดการ Platform Admins (สำหรับ Platform Admin เท่านั้น)
- ✅ ฟอร์มสร้าง/แก้ไข admin

---

## 6. Error Handling & Status Codes

### ✅ 6.1 HTTP Status Codes ที่ต้อง Handle

| Status Code | Meaning | Frontend Action |
|-------------|---------|-----------------|
| `200` | Success | แสดงข้อมูลปกติ |
| `201` | Created | แสดงข้อความสำเร็จ + redirect หรือ refresh list |
| `400` | Bad Request | แสดง validation errors |
| `401` | Unauthorized | Refresh token → retry request → ถ้า fail → logout + redirect login |
| `403` | Forbidden | แสดงข้อความ "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" |
| `404` | Not Found | แสดงข้อความ "ไม่พบข้อมูล" |
| `429` | Too Many Requests | แสดงข้อความ "กรุณาลองใหม่อีกครั้งภายหลัง" + disable button |
| `500` | Internal Server Error | แสดงข้อความ "เกิดข้อผิดพลาดจากระบบ กรุณาลองใหม่อีกครั้ง" |

### ✅ 6.2 Error Response Format

Backend จะส่ง error response ในรูปแบบ:

```typescript
{
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp?: string;
  path?: string;
}
```

**Frontend ต้องทำ:**
- ✅ Parse error response และแสดงข้อความที่เหมาะสม
- ✅ Handle validation errors (array of messages)
- ✅ Log errors สำหรับ debugging

### ✅ 6.3 Rate Limiting

**Rate Limits:**
- Global: 100 requests per IP per 60 seconds
- Register: 5 requests per IP per 60 seconds
- Login: 10 requests per IP per 60 seconds
- Refresh: 30 requests per IP per 60 seconds

**Frontend ต้องทำ:**
- ✅ Handle 429 response
- ✅ แสดงข้อความ "คุณส่งคำขอมากเกินไป กรุณาลองใหม่อีกครั้งภายหลัง"
- ✅ Disable submit button ชั่วคราว
- ✅ Implement exponential backoff สำหรับ retry

---

## 7. Testing Checklist

### ✅ 7.1 Authentication Flow

- [ ] Register new user → เก็บ tokens และ user data
- [ ] Login → เก็บ tokens และ user data
- [ ] Refresh token เมื่อ access token หมดอายุ
- [ ] Logout → clear tokens และ redirect
- [ ] Handle invalid credentials
- [ ] Handle expired refresh token

### ✅ 7.2 Authorization & RBAC

- [ ] แสดงเมนูตาม role
- [ ] ป้องกันการเข้าถึงหน้าจอที่ไม่มีสิทธิ์
- [ ] Handle 403 Forbidden response
- [ ] ซ่อน action buttons ตาม role

### ✅ 7.3 Core Modules Testing

**Guests:**
- [ ] List guests (with pagination, search)
- [ ] Create guest
- [ ] Update guest
- [ ] Delete guest (admin only)

**Bookings:**
- [ ] List bookings (with filters)
- [ ] Create booking
- [ ] Update booking
- [ ] Cancel booking

**Rooms:**
- [ ] List rooms
- [ ] Search available rooms (with checkIn/checkOut)
- [ ] Create room (admin only)
- [ ] Update room status
- [ ] Delete room (admin only)

**Restaurant:**
- [ ] List menu items
- [ ] Create menu item (admin only)
- [ ] Update menu item (admin only)
- [ ] Delete menu item (admin only)

**HR:**
- [ ] List employees
- [ ] Create employee (admin only)
- [ ] Update employee (admin only)
- [ ] Delete employee (admin only)

**Channels:**
- [ ] List channels
- [ ] Create channel (admin only)
- [ ] Sync channel data
- [ ] Toggle active status (admin only)

**Reviews:**
- [ ] List reviews
- [ ] View review statistics
- [ ] Generate QR code for review
- [ ] View review by QR code
- [ ] Create review

### ✅ 7.4 SaaS/Subscription Modules Testing

**Onboarding:**
- [ ] Register new hotel
- [ ] View trial status

**Tenants:**
- [ ] List hotels (platform_admin only)
- [ ] View hotel details (with subscription info)

**Subscriptions:**
- [ ] View subscription details
- [ ] Upgrade plan
- [ ] Add feature
- [ ] Downgrade plan

**Feature Access:**
- [ ] Check feature access
- [ ] List tenant features
- [ ] View subscription status

**Payments:**
- [ ] Upload payment slip
- [ ] View payment status
- [ ] Approve payment (platform_admin only)
- [ ] Reject payment (platform_admin only)

**Invoices:**
- [ ] List invoices
- [ ] View invoice details
- [ ] Download/Print invoice

### ✅ 7.5 Admin Panel Testing

- [ ] View dashboard (platform_admin only)
- [ ] View all hotels
- [ ] View pending payments
- [ ] Approve/Reject payments

### ✅ 7.6 Error Handling Testing

- [ ] Handle 401 → auto refresh token
- [ ] Handle 403 → show permission error
- [ ] Handle 404 → show not found message
- [ ] Handle 429 → show rate limit message
- [ ] Handle 500 → show server error message
- [ ] Handle network errors
- [ ] Handle validation errors

### ✅ 7.7 UI/UX Testing

- [ ] Loading states สำหรับ async operations
- [ ] Success/Error notifications
- [ ] Form validation
- [ ] Confirmation dialogs สำหรับ destructive actions
- [ ] Responsive design
- [ ] Accessibility (keyboard navigation, screen readers)

---

## 8. สรุป Checklist สำหรับทีม Frontend

### ✅ Phase 1: Setup & Authentication (Priority: High)
- [ ] Setup environment variables
- [ ] Create API client with token management
- [ ] Implement authentication flow (login, register, refresh, logout)
- [ ] Implement RBAC (role-based UI)
- [ ] Handle error responses (401, 403, 429, etc.)

### ✅ Phase 2: Core Hotel Management (Priority: High)
- [ ] Guests module
- [ ] Bookings module
- [ ] Rooms module
- [ ] Restaurant module
- [ ] HR module
- [ ] Channels module
- [ ] Reviews module

### ✅ Phase 3: SaaS/Subscription Management (Priority: Medium)
- [ ] Onboarding flow
- [ ] Subscription management
- [ ] Feature access control
- [ ] Payment upload & tracking
- [ ] Invoice viewing

### ✅ Phase 4: Admin Panel (Priority: Low)
- [ ] Platform admin dashboard
- [ ] Hotel management
- [ ] Payment approval workflow
- [ ] Admin management

---

## 9. Resources & References

### 📚 Documentation
- **Swagger API Docs:** `http://localhost:3001/api/docs`
- **Backend API Integration Guide:** `FRONTEND_API_INTEGRATION.md`
- **Backend Status:** `BACKEND_STATUS.md`

### 🔗 Useful Endpoints for Testing
- **Health Check:** (ถ้ามี)
- **Swagger UI:** `http://localhost:3001/api/docs`
- **API Base:** `http://localhost:3001/api/v1`

### 📝 Notes
- ⚠️ **Modules ที่ไม่มี version prefix:** `onboarding`, `tenants`, `plans`, `features`, `subscriptions`, `subscription-management`, `feature-access`, `invoices`, `payments`, `admin-approval`, `admin-panel`, `admins`
- ✅ **Modules ที่มี version prefix (`/v1`):** `auth`, `guests`, `bookings`, `rooms`, `restaurant`, `hr`, `channels`, `reviews`
- 🔐 **Authentication:** ทุก endpoint (ยกเว้น public) ต้องส่ง `Authorization: Bearer <token>`
- 🚦 **Rate Limiting:** ระวัง rate limits โดยเฉพาะ auth endpoints

---

**สร้างโดย:** Backend Team  
**วันที่:** 2024-12-14  
**Version:** 1.0

