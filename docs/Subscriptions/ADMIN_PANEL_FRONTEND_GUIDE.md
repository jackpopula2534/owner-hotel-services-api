# 📘 StaySync Admin Panel - Frontend Integration Guide

> เอกสารสำหรับทีม Frontend ใช้ในการพัฒนาหน้า Admin Panel

**Base URL:** `http://localhost:3000/api/v1`
**Authentication:** Bearer Token (JWT)
**Admin Login:** `admin@hotelservices.com` / `Admin@123` (ผ่าน `/auth/admin/login` เท่านั้น)

---

## 🔑 สำคัญ: การใช้ Primary Key

**ทุก API ที่แสดงรายการข้อมูล (List endpoints) จะส่ง `id` (UUID) เป็น Primary Key เพื่อใช้ในการอัปเดทข้อมูล**

- **Subscriptions API**:
  - ใช้ `id` (UUID) สำหรับ PATCH/DELETE operations
  - ใช้ `subscriptionCode` (SUB-001) สำหรับแสดงผล

- **Invoices API**:
  - ใช้ `id` (UUID) สำหรับ PATCH/DELETE operations
  - ใช้ `invoiceNumber` (INV-2024-045) สำหรับแสดงผล

- **Hotels API**:
  - ใช้ `id` (UUID) สำหรับ PATCH operations

- **Subscription Features API**:
  - ใช้ `subscriptionUuid` (UUID) สำหรับระบุ subscription
  - ใช้ `subscriptionCode` (SUB-001) สำหรับแสดงผล
  - ใช้ addon `id` (UUID) สำหรับ PATCH/DELETE addon

- **Invoice Adjustments API**:
  - ใช้ invoice `id` (UUID) สำหรับ PATCH/VOID operations
  - ใช้ item `id` (UUID) สำหรับ PATCH line items

---

## 📑 สารบัญ

1. [Authentication](#1-authentication)
2. [Hotels Management](#2-hotels-management)
3. [Invoices Management](#3-invoices-management)
4. [Subscriptions Management](#4-subscriptions-management)
5. [Add-on Management (Phase 1)](#5-add-on-management-phase-1)
6. [Invoice Adjustment (Phase 2)](#6-invoice-adjustment-phase-2)
7. [Billing Cycle Management (Phase 3)](#7-billing-cycle-management-phase-3)
8. [Refund & Credit System (Phase 4)](#8-refund--credit-system-phase-4)
9. [Common Response Format](#9-common-response-format)
10. [Error Handling](#10-error-handling)

---

## 1. Authentication

### Login

```http
POST /api/v1/auth/admin/login
Content-Type: application/json

{
  "email": "admin@hotelservices.com",
  "password": "Admin@123"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "admin@hotelservices.com",
    "role": "platform_admin",
    "isPlatformAdmin": true
  }
}
```

> ⚠️ ทุก API ต้องส่ง Header: `Authorization: Bearer {accessToken}`

---

## 2. Hotels Management

### 2.1 รายการโรงแรมทั้งหมด

```http
GET /api/v1/admin/hotels?page=1&limit=10&status=active&search=สุขใจ
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | หน้าที่ต้องการ |
| limit | number | 10 | จำนวนต่อหน้า |
| status | string | all | `active`, `trial`, `expired`, `suspended` |
| search | string | - | ค้นหาชื่อโรงแรม |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "hotelName": "โรงแรมสุขใจ",
      "ownerName": "สมชาย ใจดี",
      "plan": "Professional",
      "rooms": 45,
      "users": 5,
      "status": "Active",
      "revenue": 47958
    }
  ],
  "total": 6,
  "page": 1,
  "limit": 10
}
```

### 2.2 สรุปจำนวนโรงแรมตามสถานะ

```http
GET /api/v1/admin/hotels/summary
```

**Response:**
```json
{
  "total": 6,
  "active": 3,
  "trial": 1,
  "expired": 1,
  "suspended": 1
}
```

### 2.3 รายละเอียดโรงแรม

```http
GET /api/v1/admin/hotels/{id}
```

**Response:**
```json
{
  "id": "uuid",
  "hotelName": "โรงแรมสุขใจ",
  "ownerName": "สมชาย ใจดี",
  "email": "somchai@email.com",
  "createdAt": "2023-06-15",
  "rooms": 45,
  "users": 5,
  "plan": "Professional",
  "status": "Active",
  "revenue": 47958,
  "subscription": {
    "expiresAt": "2024-02-15"
  }
}
```

### 2.4 อัปเดตสถานะโรงแรม

```http
PATCH /api/v1/admin/hotels/{id}/status
Content-Type: application/json

{
  "status": "suspended"  // "active", "suspended"
}
```

---

## 3. Invoices Management

### 3.1 รายการใบแจ้งหนี้

```http
GET /api/v1/admin/invoices?page=1&limit=10&status=pending
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| page | number | 1 | หน้าที่ต้องการ |
| limit | number | 10 | จำนวนต่อหน้า |
| status | string | all | `pending`, `paid`, `rejected`, `voided` |
| search | string | - | ค้นหาเลข Invoice หรือชื่อโรงแรม |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "invoiceNumber": "INV-2024-045",
      "hotelName": "โรงแรมสุขใจ",
      "ownerEmail": "somchai@email.com",
      "plan": "Professional +2 add-ons",
      "amount": 7993,
      "status": "pending",
      "date": "2024-01-10T14:30:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 10
}
```

> **⚠️ IMPORTANT:** ใช้ `id` (UUID) สำหรับการอัปเดทข้อมูล และใช้ `invoiceNumber` สำหรับแสดงผล

### 3.2 สรุปใบแจ้งหนี้

```http
GET /api/v1/admin/invoices/summary
```

**Response:**
```json
{
  "total": 5,
  "pending": 3,
  "paid": 1,
  "rejected": 1
}
```

### 3.3 อนุมัติ/ปฏิเสธใบแจ้งหนี้

```http
PATCH /api/v1/admin/invoices/{id}/status
Content-Type: application/json

{
  "status": "approved",  // "approved", "rejected"
  "reason": "Invalid payment slip"  // required if rejected
}
```

---

## 4. Subscriptions Management

### 4.1 รายการ Subscriptions

```http
GET /api/v1/admin/subscriptions?page=1&limit=10&status=active
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "subscriptionCode": "SUB-001",
      "hotelName": "โรงแรมสุขใจ",
      "plan": "Professional",
      "previousPlan": "Starter",
      "period": {
        "start": "2024-01-01",
        "end": "2024-02-01"
      },
      "addons": [
        { "name": "Extra Analytics", "price": 990 },
        { "name": "Custom Branding", "price": 1490 }
      ],
      "addonAmount": 2480,
      "pricePerMonth": 7470,
      "status": "Active"
    }
  ],
  "total": 4,
  "page": 1,
  "limit": 10
}
```

> **⚠️ IMPORTANT:** ใช้ `id` (UUID) สำหรับการอัปเดทข้อมูล และใช้ `subscriptionCode` สำหรับแสดงผล

### 4.2 สรุป Subscriptions

```http
GET /api/v1/admin/subscriptions/summary
```

**Response:**
```json
{
  "active": 2,
  "trial": 1,
  "pending": 1,
  "mrr": 21430,
  "upgrades": 1,
  "downgrades": 1
}
```

---

## 5. Add-on Management (Phase 1)

### 5.1 ดู Add-ons ของ Subscription

```http
GET /api/v1/admin/subscription-features/{subscriptionId}
```

> `subscriptionId` รองรับทั้ง UUID และ `SUB-xxx` format

**Response:**
```json
{
  "subscriptionUuid": "uuid",
  "subscriptionCode": "SUB-001",
  "hotelName": "โรงแรมสุขใจ",
  "planName": "Professional",
  "planPrice": 4990,
  "addons": [
    {
      "id": "uuid",
      "featureId": "uuid",
      "featureName": "Extra Analytics",
      "featureDescription": "รายงานและ Analytics ขั้นสูง",
      "featureType": "module",
      "quantity": 1,
      "price": 990,
      "totalPrice": 990,
      "isActive": true,
      "createdAt": "2024-01-01"
    }
  ],
  "totalAddonPrice": 2480,
  "totalMonthlyPrice": 7470
}
```

### 5.2 เพิ่ม Add-on

```http
POST /api/v1/admin/subscription-features
Content-Type: application/json

{
  "subscriptionId": "SUB-001",
  "featureId": "uuid",
  "quantity": 1,
  "price": 990,
  "effectiveDate": "2024-02-01",
  "createInvoice": true
}
```

### 5.3 แก้ไข Add-on

```http
PATCH /api/v1/admin/subscription-features/{id}
Content-Type: application/json

{
  "quantity": 5,
  "price": 1490,
  "reason": "Customer requested upgrade",
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
    "oldPrice": 990,
    "newPrice": 1490,
    "oldQuantity": 1,
    "newQuantity": 5,
    "proratedAmount": 250,
    "effectiveDate": "2024-02-01"
  }
}
```

### 5.4 ลบ Add-on

```http
POST /api/v1/admin/subscription-features/{id}/remove
Content-Type: application/json

{
  "reason": "Customer requested cancellation",
  "effectiveDate": "2024-02-01",
  "createCredit": true
}
```

### 5.5 ดู Change Logs

```http
GET /api/v1/admin/subscription-features/{subscriptionId}/logs
```

---

## 6. Invoice Adjustment (Phase 2)

### 6.1 ดู Invoice พร้อม Line Items

```http
GET /api/v1/admin/invoices/{id}/items
```

**Response:**
```json
{
  "id": "uuid",
  "invoiceNo": "INV-2024-045",
  "hotelName": "โรงแรมสุขใจ",
  "status": "pending",
  "items": [
    {
      "id": "uuid",
      "type": "plan",
      "description": "Professional Plan - Monthly",
      "quantity": 1,
      "unitPrice": 4990,
      "amount": 4990,
      "isAdjusted": false
    }
  ],
  "subtotal": 7470,
  "totalAdjustments": -500,
  "total": 6970,
  "dueDate": "2024-02-15"
}
```

> **⚠️ IMPORTANT:** ใช้ `id` (UUID) สำหรับการอัปเดท invoice และ item `id` สำหรับอัปเดท line items

### 6.2 ปรับยอด Invoice (Discount/Credit/Surcharge)

```http
POST /api/v1/admin/invoices/{id}/adjust
Content-Type: application/json

{
  "type": "discount",      // "discount", "credit", "surcharge", "proration"
  "amount": 500,
  "reason": "Customer loyalty discount",
  "notes": "10% discount for 1 year customer",
  "generateCreditMemo": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Invoice adjusted successfully",
  "data": {
    "invoiceNo": "INV-2024-045",
    "adjustmentType": "discount",
    "adjustmentAmount": 500,
    "originalAmount": 7470,
    "newAmount": 6970,
    "creditMemoNo": "CM-2024-123456"
  }
}
```

### 6.3 ยกเลิก Invoice (Void)

```http
POST /api/v1/admin/invoices/{id}/void
Content-Type: application/json

{
  "reason": "Customer cancelled subscription",
  "createCredit": true,
  "notes": "Full refund processed"
}
```

### 6.4 แก้ไข Invoice Item

```http
PATCH /api/v1/admin/invoice-items/{id}
Content-Type: application/json

{
  "quantity": 2,
  "unitPrice": 4990,
  "description": "Professional Plan - Monthly (Updated)",
  "reason": "Customer upgraded quantity"
}
```

### 6.5 ดูประวัติการปรับ Invoice

```http
GET /api/v1/admin/invoices/{id}/adjustments
```

---

## 7. Billing Cycle Management (Phase 3)

### 7.1 ดูข้อมูล Billing

```http
GET /api/v1/admin/subscriptions/{id}/billing-info
```

**Response:**
```json
{
  "subscriptionCode": "SUB-001",
  "hotelName": "โรงแรมสุขใจ",
  "planName": "Professional",
  "planPrice": 4990,
  "billingCycle": "monthly",
  "status": "active",
  "currentPeriodStart": "2024-01-01",
  "currentPeriodEnd": "2024-02-01",
  "nextBillingDate": "2024-02-01",
  "billingAnchorDate": "2024-01-01",
  "autoRenew": true,
  "renewedCount": 3,
  "lastRenewedAt": "2024-01-01T10:30:00Z",
  "addonAmount": 2480,
  "totalMonthlyAmount": 7470
}
```

### 7.2 ดูประวัติ Billing

```http
GET /api/v1/admin/subscriptions/{id}/billing-history
```

**Response:**
```json
{
  "subscriptionCode": "SUB-001",
  "hotelName": "โรงแรมสุขใจ",
  "currentPlan": "Professional",
  "billingCycle": "monthly",
  "nextBillingDate": "2024-02-01",
  "history": [
    {
      "id": "uuid",
      "eventType": "renewed",
      "description": "Subscription renewed for 1 month",
      "newAmount": 7470,
      "periodStart": "2024-01-01",
      "periodEnd": "2024-02-01",
      "invoiceNo": "INV-2024-045",
      "createdAt": "2024-01-01T10:30:00Z"
    }
  ],
  "total": 10
}
```

### 7.3 เปลี่ยนรอบบิล

```http
PATCH /api/v1/admin/subscriptions/{id}/billing-cycle
Content-Type: application/json

{
  "billingCycle": "yearly",     // "monthly", "yearly"
  "effectiveDate": "2024-03-01",
  "applyProration": true,
  "reason": "Customer requested yearly billing for discount"
}
```

### 7.4 ต่ออายุ Subscription

```http
POST /api/v1/admin/subscriptions/{id}/renew
Content-Type: application/json

{
  "periodMonths": 6,          // optional, default from billing cycle
  "customPrice": 25000,       // optional, default from plan price
  "createInvoice": true,
  "notes": "Special 6-month renewal"
}
```

### 7.5 ยกเลิกการต่ออายุ

```http
POST /api/v1/admin/subscriptions/{id}/cancel-renewal
Content-Type: application/json

{
  "reason": "Customer requested cancellation",
  "cancelImmediately": false,   // true = ยกเลิกทันที, false = ใช้ได้ถึงสิ้นสุด period
  "createCredit": true          // สร้าง credit ถ้ายกเลิกทันที
}
```

---

## 8. Refund & Credit System (Phase 4)

### 8.1 สรุป Refunds

```http
GET /api/v1/admin/refunds/summary
```

**Response:**
```json
{
  "totalPending": 5,
  "totalApproved": 10,
  "totalRejected": 2,
  "totalCompleted": 8,
  "totalPendingAmount": 25000,
  "totalRefundedAmount": 150000
}
```

### 8.2 รายการ Refunds

```http
GET /api/v1/admin/refunds?status=pending
```

**Response:**
```json
[
  {
    "id": "uuid",
    "refundNo": "REF-2024-001",
    "paymentNo": "PAY-2024-045",
    "invoiceNo": "INV-2024-045",
    "amount": 1000,
    "status": "pending",
    "method": "bank_transfer",
    "reason": "Customer request",
    "bankName": "Bangkok Bank",
    "bankAccount": "123-456-789",
    "createdAt": "2024-01-25T10:30:00Z"
  }
]
```

### 8.3 สร้าง Refund

```http
POST /api/v1/admin/payments/{paymentId}/refund
Content-Type: application/json

{
  "amount": 1000,
  "reason": "Customer requested refund",
  "method": "credit",           // "credit", "bank_transfer", "original_method"
  "notes": "Processed as account credit"
}
```

**For Bank Transfer:**
```json
{
  "amount": 2000,
  "reason": "Service cancellation refund",
  "method": "bank_transfer",
  "bankAccount": "123-456-789",
  "bankName": "Bangkok Bank",
  "accountHolder": "John Doe"
}
```

### 8.4 อนุมัติ/ปฏิเสธ Refund

```http
PATCH /api/v1/admin/refunds/{id}/process
Content-Type: application/json

// Approve
{
  "action": "approved",
  "notes": "Verified and approved"
}

// Reject
{
  "action": "rejected",
  "rejectedReason": "Invalid refund request - service was used"
}
```

### 8.5 ดู Credits ของ Tenant

```http
GET /api/v1/admin/tenants/{tenantId}/credits
```

**Response:**
```json
{
  "tenantId": "uuid",
  "tenantName": "โรงแรมสุขใจ",
  "totalAvailable": 2500,
  "totalUsed": 5000,
  "totalEarned": 7500,
  "credits": [
    {
      "id": "uuid",
      "type": "refund",
      "status": "available",
      "originalAmount": 1000,
      "remainingAmount": 1000,
      "description": "Refund from payment PAY-2024-001",
      "createdAt": "2024-01-25T10:30:00Z"
    },
    {
      "id": "uuid",
      "type": "promotion",
      "status": "available",
      "originalAmount": 1500,
      "remainingAmount": 1500,
      "description": "New Year 2024 promotion",
      "expiresAt": "2024-12-31",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 8.6 เพิ่ม Credit

```http
POST /api/v1/admin/tenants/{tenantId}/credits
Content-Type: application/json

{
  "amount": 500,
  "type": "manual",          // "manual", "promotion", "proration", "cancellation"
  "description": "Courtesy credit for service issue",
  "expiresAt": "2024-12-31"  // optional
}
```

### 8.7 ใช้ Credit จ่าย Invoice

```http
POST /api/v1/admin/invoices/{invoiceId}/apply-credit
Content-Type: application/json

{
  "useOldestFirst": true     // ใช้ credit เก่าสุดก่อน (default)
}

// หรือระบุ credit เฉพาะ
{
  "creditId": "uuid",
  "amount": 500
}
```

**Response:**
```json
{
  "success": true,
  "message": "Credit applied successfully",
  "data": {
    "invoiceNo": "INV-2024-045",
    "originalAmount": 4990,
    "creditApplied": 2500,
    "newAmount": 2490,
    "creditsUsed": [
      { "creditId": "uuid-1", "amount": 1000 },
      { "creditId": "uuid-2", "amount": 1500 }
    ],
    "remainingCredit": 0
  }
}
```

---

## 9. Common Response Format

### Success Response (List)
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 10
}
```

### Success Response (Action)
```json
{
  "success": true,
  "message": "Action completed successfully",
  "data": { ... }
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

---

## 10. Error Handling

| Status Code | Description |
|-------------|-------------|
| 400 | Bad Request - ข้อมูลไม่ถูกต้อง |
| 401 | Unauthorized - ไม่ได้ login หรือ token หมดอายุ |
| 403 | Forbidden - ไม่มีสิทธิ์เข้าถึง (ต้องเป็น platform_admin) |
| 404 | Not Found - ไม่พบข้อมูล |
| 500 | Internal Server Error - ข้อผิดพลาดภายในระบบ |

---

## 📦 Postman Collection

Import ไฟล์นี้เพื่อทดสอบ API:
```
postman/StaySync_Admin_Panel_API.postman_collection.json
```

---

## 🔑 Test Credentials

| Role | Email | Password | Login Endpoint |
|------|-------|----------|----------------|
| Platform Admin | admin@hotelservices.com | Admin@123 | `/auth/admin/login` |

---

## 📋 Status Enums

### Hotel Status
- `active` - ใช้งานปกติ
- `trial` - ทดลองใช้
- `expired` - หมดอายุ
- `suspended` - ถูกระงับ

### Subscription Status
- `trial` - ทดลองใช้
- `pending` - รอดำเนินการ
- `active` - ใช้งานอยู่
- `expired` - หมดอายุ
- `cancelled` - ยกเลิก

### Invoice Status
- `pending` - รอชำระ
- `paid` - ชำระแล้ว
- `rejected` - ปฏิเสธ
- `voided` - ยกเลิก

### Refund Status
- `pending` - รออนุมัติ
- `approved` - อนุมัติแล้ว
- `rejected` - ปฏิเสธ
- `completed` - เสร็จสิ้น

### Credit Type
- `manual` - Admin เพิ่มเอง
- `refund` - จากการ Refund
- `proration` - จากการคำนวณตามสัดส่วน
- `promotion` - โปรโมชัน
- `cancellation` - จากการยกเลิก

### Credit Status
- `available` - ใช้ได้
- `used` - ใช้แล้ว
- `expired` - หมดอายุ
- `cancelled` - ยกเลิก

---

**Last Updated:** January 2024  
**API Version:** v1
