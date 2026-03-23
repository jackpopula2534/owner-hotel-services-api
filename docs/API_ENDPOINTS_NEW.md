# API Endpoints Documentation

> สรุป API ที่พัฒนาใหม่สำหรับ Frontend Integration

**Base URL:** `http://localhost:9011`

**Last Updated:** 2024-03-21

---

## Table of Contents

1. [Authentication](#authentication)
2. [Phase 1: Email Notification](#phase-1-email-notification)
3. [Phase 1: PromptPay Payment](#phase-1-promptpay-payment)
4. [Phase 1: Reports Export](#phase-1-reports-export)
5. [Phase 2: Two-Factor Authentication](#phase-2-two-factor-authentication)
6. [Phase 2: Audit Logging](#phase-2-audit-logging)
7. [Phase 3: Line Notify](#phase-3-line-notify)
8. [Phase 3: i18n Translation](#phase-3-i18n-translation)
9. [Phase 4: Database Performance](#phase-4-database-performance-admin)
10. [Phase 4: Mobile API](#phase-4-mobile-api)
11. [Phase 4: Push Notifications](#phase-4-push-notifications)

---

## Authentication

สำหรับ endpoints ที่ต้องการ Authentication ให้ส่ง Header:

```
Authorization: Bearer <jwt-token>
```

---

## Phase 1: Email Notification

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `POST` | `/email/send` | ส่งอีเมลเดี่ยว | ✅ |
| `POST` | `/email/send-bulk` | ส่งอีเมลหลายฉบับ | ✅ |
| `GET` | `/email/history` | ดูประวัติการส่งอีเมล | ✅ |
| `GET` | `/email/templates` | ดู templates ที่มี | ✅ |
| `GET` | `/email/preferences/:email` | ดูการตั้งค่าอีเมล | ✅ |
| `PUT` | `/email/preferences/:email` | อัพเดทการตั้งค่าอีเมล | ✅ |

### Send Email

**POST** `/email/send`

```json
{
  "to": "guest@email.com",
  "template": "booking_confirmation",
  "data": {
    "guestName": "John Doe",
    "bookingNumber": "BK123456",
    "checkInDate": "2024-03-25",
    "checkOutDate": "2024-03-27",
    "roomType": "Deluxe Room",
    "totalPrice": 5000
  },
  "language": "th"
}
```

### Available Templates

| Template | Description |
|----------|-------------|
| `booking_confirmation` | ยืนยันการจอง |
| `booking_cancellation` | ยกเลิกการจอง |
| `check_in_reminder` | แจ้งเตือนเช็คอิน (1 วันล่วงหน้า) |
| `payment_receipt` | ใบเสร็จรับเงิน |
| `password_reset` | รีเซ็ตรหัสผ่าน |
| `welcome` | ต้อนรับผู้ใช้ใหม่ |

### Email Preferences

**GET** `/email/preferences/:email`

```json
{
  "email": "guest@email.com",
  "bookingConfirmation": true,
  "checkInReminder": true,
  "checkOutReminder": true,
  "paymentReceipt": true,
  "promotionalEmails": false,
  "newsletter": false
}
```

---

## Phase 1: PromptPay Payment

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `POST` | `/promptpay/generate-qr` | สร้าง QR Code | ✅ |
| `GET` | `/promptpay/status/:transactionRef` | เช็คสถานะการชำระ | ✅ |
| `POST` | `/promptpay/webhook` | รับ webhook จากธนาคาร | ❌ |
| `POST` | `/promptpay/verify/:transactionRef` | ยืนยันการชำระ (manual) | ✅ |
| `GET` | `/promptpay/transactions` | ดูรายการทั้งหมด | ✅ |

### Generate QR Code

**POST** `/promptpay/generate-qr`

**Request:**
```json
{
  "amount": 1500.00,
  "bookingId": "uuid-booking-id",
  "description": "ชำระค่าห้องพัก"
}
```

**Response:**
```json
{
  "transactionRef": "PP20240321123456",
  "qrCodeData": "00020101021229370016A000000677010111...",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgo...",
  "amount": 1500.00,
  "expiresAt": "2024-03-21T15:30:00Z",
  "status": "pending"
}
```

### Check Payment Status

**GET** `/promptpay/status/:transactionRef`

**Response:**
```json
{
  "transactionRef": "PP20240321123456",
  "status": "paid",
  "amount": 1500.00,
  "paidAt": "2024-03-21T14:25:00Z",
  "verifiedAt": "2024-03-21T14:25:30Z"
}
```

**Status Values:** `pending` | `paid` | `verified` | `expired` | `failed` | `refunded`

---

## Phase 1: Reports Export

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/reports/revenue` | รายงานรายได้ | ✅ |
| `GET` | `/reports/occupancy` | รายงานอัตราเข้าพัก | ✅ |
| `GET` | `/reports/export/pdf` | Export PDF | ✅ |
| `GET` | `/reports/export/excel` | Export Excel | ✅ |
| `GET` | `/reports/export/csv` | Export CSV | ✅ |

### Query Parameters

```
?startDate=2024-03-01&endDate=2024-03-31&reportType=revenue
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | string | วันที่เริ่มต้น (YYYY-MM-DD) |
| `endDate` | string | วันที่สิ้นสุด (YYYY-MM-DD) |
| `reportType` | string | `revenue` \| `occupancy` \| `booking` |

### Export Response

Returns file download with appropriate headers:
- PDF: `Content-Type: application/pdf`
- Excel: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- CSV: `Content-Type: text/csv`

---

## Phase 2: Two-Factor Authentication

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `POST` | `/2fa/enable` | เปิดใช้งาน 2FA | ✅ |
| `POST` | `/2fa/verify` | ยืนยัน 2FA code | ✅ |
| `POST` | `/2fa/disable` | ปิดการใช้งาน 2FA | ✅ |
| `GET` | `/2fa/status` | เช็คสถานะ 2FA | ✅ |
| `POST` | `/2fa/backup-codes/regenerate` | สร้าง backup codes ใหม่ | ✅ |
| `POST` | `/2fa/login` | Login ด้วย 2FA | ❌ |

### Enable 2FA

**POST** `/2fa/enable`

**Response:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCodeUrl": "otpauth://totp/HotelApp:user@email.com?secret=JBSWY3DPEHPK3PXP&issuer=HotelApp",
  "qrCodeImage": "data:image/png;base64,iVBORw0KGgo...",
  "backupCodes": [
    "12345678",
    "23456789",
    "34567890",
    "45678901",
    "56789012",
    "67890123",
    "78901234",
    "89012345"
  ]
}
```

### Verify 2FA

**POST** `/2fa/verify`

**Request:**
```json
{
  "code": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "2FA verification successful"
}
```

### Login with 2FA

**POST** `/2fa/login`

**Request:**
```json
{
  "email": "user@email.com",
  "password": "password123",
  "code": "123456"
}
```

### 2FA Status

**GET** `/2fa/status`

**Response:**
```json
{
  "isEnabled": true,
  "enabledAt": "2024-03-20T10:00:00Z",
  "backupCodesRemaining": 6
}
```

---

## Phase 2: Audit Logging

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/audit-logs` | ดู audit logs | ✅ |
| `GET` | `/audit-logs/:id` | ดู log ตาม ID | ✅ |
| `GET` | `/audit-logs/export` | Export CSV | ✅ |

### Query Parameters

```
?page=1&limit=20&action=login&resource=user&userId=xxx&startDate=2024-03-01&endDate=2024-03-31
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | หน้าที่ต้องการ (default: 1) |
| `limit` | number | จำนวนต่อหน้า (default: 20, max: 100) |
| `action` | string | ประเภท action |
| `resource` | string | ประเภท resource |
| `userId` | string | กรองตาม user |
| `startDate` | string | วันที่เริ่มต้น |
| `endDate` | string | วันที่สิ้นสุด |

### Actions

`login` | `logout` | `create` | `update` | `delete` | `view` | `export` | `enable_2fa` | `disable_2fa` | `password_change` | `password_reset`

### Resources

`user` | `booking` | `guest` | `room` | `payment` | `invoice` | `report` | `setting`

### Response

```json
{
  "data": [
    {
      "id": "uuid-log-id",
      "action": "login",
      "resource": "user",
      "resourceId": "user-uuid",
      "userId": "user-uuid",
      "adminId": null,
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "description": "User logged in successfully",
      "oldValues": null,
      "newValues": null,
      "createdAt": "2024-03-21T10:30:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

---

## Phase 3: Line Notify

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/line-notify/connect` | รับ URL สำหรับเชื่อมต่อ | ✅ |
| `GET` | `/line-notify/callback` | OAuth callback | ❌ |
| `GET` | `/line-notify/status` | เช็คสถานะการเชื่อมต่อ | ✅ |
| `POST` | `/line-notify/preferences` | ตั้งค่าการแจ้งเตือน | ✅ |
| `GET` | `/line-notify/event-types` | ดูประเภทการแจ้งเตือน | ✅ |
| `DELETE` | `/line-notify/disconnect` | ยกเลิกการเชื่อมต่อ | ✅ |
| `POST` | `/line-notify/test` | ส่งข้อความทดสอบ | ✅ |
| `POST` | `/line-notify/send` | ส่งข้อความ | ✅ |
| `GET` | `/line-notify/users` | ดูผู้ใช้ที่เชื่อมต่อ (admin) | ✅ |

### Connect Line Notify

**GET** `/line-notify/connect`

**Response:**
```json
{
  "authUrl": "https://notify-bot.line.me/oauth/authorize?response_type=code&client_id=xxx&redirect_uri=xxx&scope=notify&state=xxx"
}
```

### Connection Status

**GET** `/line-notify/status`

**Response:**
```json
{
  "isConnected": true,
  "targetName": "My Group",
  "targetType": "GROUP",
  "enabledEvents": ["booking_created", "payment_received", "daily_summary"],
  "connectedAt": "2024-03-20T10:00:00Z"
}
```

### Event Types

**GET** `/line-notify/event-types`

**Response:**
```json
{
  "eventTypes": [
    { "key": "booking_created", "label": "New Booking", "labelTh": "การจองใหม่" },
    { "key": "booking_confirmed", "label": "Booking Confirmed", "labelTh": "ยืนยันการจอง" },
    { "key": "booking_cancelled", "label": "Booking Cancelled", "labelTh": "ยกเลิกการจอง" },
    { "key": "booking_checkin", "label": "Check-in", "labelTh": "เช็คอิน" },
    { "key": "booking_checkout", "label": "Check-out", "labelTh": "เช็คเอาท์" },
    { "key": "payment_received", "label": "Payment Received", "labelTh": "ได้รับชำระเงิน" },
    { "key": "payment_failed", "label": "Payment Failed", "labelTh": "ชำระเงินไม่สำเร็จ" },
    { "key": "daily_summary", "label": "Daily Summary", "labelTh": "สรุปประจำวัน" },
    { "key": "new_review", "label": "New Review", "labelTh": "รีวิวใหม่" },
    { "key": "system_alert", "label": "System Alert", "labelTh": "การแจ้งเตือนระบบ" }
  ]
}
```

### Update Preferences

**POST** `/line-notify/preferences`

**Request:**
```json
{
  "enabledEvents": ["booking_created", "payment_received", "daily_summary"]
}
```

### Send Message

**POST** `/line-notify/send`

**Request:**
```json
{
  "message": "ข้อความที่ต้องการส่ง",
  "imageUrl": "https://example.com/image.jpg"
}
```

---

## Phase 3: i18n Translation

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/i18n/languages` | ดูภาษาที่รองรับ | ❌ |
| `GET` | `/i18n/namespaces` | ดู namespaces | ❌ |
| `GET` | `/i18n/translations/:language` | ดู translations ทั้งหมด | ❌ |
| `GET` | `/i18n/translations/:language/:namespace` | ดู translations ตาม namespace | ❌ |
| `POST` | `/i18n/translate` | แปลคีย์เดียว | ❌ |
| `POST` | `/i18n/translate/bulk` | แปลหลายคีย์ | ❌ |
| `GET` | `/i18n/t/:key` | แปลคีย์ (shorthand) | ❌ |
| `GET` | `/i18n/search` | ค้นหา translations | ❌ |

### Languages

**GET** `/i18n/languages`

**Response:**
```json
[
  { "code": "th", "name": "Thai", "nativeName": "ไทย", "isDefault": true },
  { "code": "en", "name": "English", "nativeName": "English", "isDefault": false }
]
```

### Namespaces

**GET** `/i18n/namespaces?language=th`

**Response:**
```json
["common", "auth", "booking", "guest", "room", "payment", "report", "notification", "settings", "validation", "errors"]
```

### Get All Translations

**GET** `/i18n/translations/th`

**Response:**
```json
{
  "common": {
    "welcome": "ยินดีต้อนรับ",
    "login": "เข้าสู่ระบบ",
    "logout": "ออกจากระบบ",
    "save": "บันทึก",
    "cancel": "ยกเลิก"
  },
  "booking": {
    "title": "การจอง",
    "newBooking": "จองห้องพัก",
    "status": {
      "pending": "รอดำเนินการ",
      "confirmed": "ยืนยันแล้ว"
    }
  }
}
```

### Translate Single Key

**POST** `/i18n/translate`

**Request:**
```json
{
  "key": "booking.status.confirmed",
  "language": "th",
  "variables": {}
}
```

**Response:**
```json
{
  "key": "booking.status.confirmed",
  "value": "ยืนยันแล้ว",
  "language": "th"
}
```

### Translate Multiple Keys

**POST** `/i18n/translate/bulk`

**Request:**
```json
{
  "keys": ["common.save", "common.cancel", "booking.title"],
  "language": "th"
}
```

**Response:**
```json
{
  "common.save": "บันทึก",
  "common.cancel": "ยกเลิก",
  "booking.title": "การจอง"
}
```

### Quick Translate

**GET** `/i18n/t/common.welcome?lang=th`

**Response:**
```json
{
  "key": "common.welcome",
  "value": "ยินดีต้อนรับ",
  "language": "th"
}
```

---

## Phase 4: Database Performance (Admin)

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/admin/database/slow-queries` | ดู slow queries | ✅ |
| `GET` | `/admin/database/query-patterns` | วิเคราะห์ query patterns | ✅ |
| `GET` | `/admin/database/n1-detection` | ตรวจจับ N+1 queries | ✅ |
| `GET` | `/admin/database/health` | สถานะ database | ✅ |
| `POST` | `/admin/database/clear-metrics` | ล้าง metrics | ✅ |

### Slow Query Report

**GET** `/admin/database/slow-queries`

**Response:**
```json
{
  "totalQueries": 1500,
  "slowQueries": 25,
  "averageDuration": 45.5,
  "slowestQueries": [
    {
      "query": "SELECT * FROM bookings WHERE ...",
      "duration": 520,
      "timestamp": "2024-03-21T10:30:00Z"
    }
  ]
}
```

### Database Health

**GET** `/admin/database/health`

**Response:**
```json
{
  "connectionPool": {
    "active": 5,
    "idle": 15
  },
  "avgQueryTime": 45.5,
  "slowQueryPercentage": 1.67
}
```

---

## Phase 4: Mobile API

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/mobile/config` | App configuration | ❌ |
| `GET` | `/mobile/dashboard` | Dashboard data | ✅ |
| `GET` | `/mobile/bookings` | รายการจอง | ✅ |
| `GET` | `/mobile/rooms` | รายการห้อง | ✅ |
| `GET` | `/mobile/guests` | รายการผู้เข้าพัก | ✅ |
| `GET` | `/mobile/search` | ค้นหา | ✅ |
| `PATCH` | `/mobile/rooms/:id/status` | อัพเดทสถานะห้อง | ✅ |
| `PATCH` | `/mobile/bookings/:id/status` | อัพเดทสถานะจอง | ✅ |
| `POST` | `/mobile/bookings/:id/checkin` | Quick check-in | ✅ |
| `POST` | `/mobile/bookings/:id/checkout` | Quick check-out | ✅ |

### App Config

**GET** `/mobile/config`

**Response:**
```json
{
  "minVersion": "1.0.0",
  "latestVersion": "1.2.0",
  "forceUpdate": false,
  "maintenanceMode": false,
  "maintenanceMessage": null,
  "features": {
    "bookingEnabled": true,
    "paymentEnabled": true,
    "pushNotifications": true
  }
}
```

### Dashboard

**GET** `/mobile/dashboard`

**Response:**
```json
{
  "todayCheckIns": 5,
  "todayCheckOuts": 3,
  "occupancyRate": 75.5,
  "totalRevenue": 45000,
  "pendingBookings": 2,
  "availableRooms": 10,
  "recentBookings": [
    {
      "id": "uuid",
      "bookingNumber": "BK123456",
      "guestName": "John Doe",
      "roomNumber": "101",
      "checkIn": "2024-03-21",
      "checkOut": "2024-03-23",
      "status": "confirmed",
      "totalPrice": 3000
    }
  ]
}
```

### Bookings List

**GET** `/mobile/bookings?page=1&limit=20&status=confirmed`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "bookingNumber": "BK123456",
      "guestName": "John Doe",
      "roomNumber": "101",
      "checkIn": "2024-03-21",
      "checkOut": "2024-03-23",
      "status": "confirmed",
      "totalPrice": 3000
    }
  ],
  "total": 50,
  "hasMore": true
}
```

### Quick Search

**GET** `/mobile/search?q=john`

**Response:**
```json
{
  "bookings": [
    { "id": "uuid", "bookingNumber": "BK123", "guestName": "John Doe", ... }
  ],
  "guests": [
    { "id": "uuid", "fullName": "John Doe", "phone": "0812345678", ... }
  ],
  "rooms": [
    { "id": "uuid", "number": "101", "type": "Deluxe", ... }
  ]
}
```

### Quick Actions

**POST** `/mobile/bookings/:id/checkin`

**Response:**
```json
{
  "id": "uuid",
  "bookingNumber": "BK123456",
  "guestName": "John Doe",
  "roomNumber": "101",
  "status": "checked_in",
  "totalPrice": 3000
}
```

---

## Phase 4: Push Notifications

### Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|:----:|
| `GET` | `/push-notifications/status` | เช็คสถานะ service | ❌ |
| `POST` | `/push-notifications/devices/register` | ลงทะเบียน device | ✅ |
| `DELETE` | `/push-notifications/devices/:token` | ยกเลิก device | ✅ |
| `GET` | `/push-notifications/devices` | ดู devices ที่ลงทะเบียน | ✅ |
| `GET` | `/push-notifications/preferences` | ดูการตั้งค่า | ✅ |
| `POST` | `/push-notifications/preferences` | อัพเดทการตั้งค่า | ✅ |
| `POST` | `/push-notifications/send` | ส่ง push (admin) | ✅ |
| `POST` | `/push-notifications/send/bulk` | ส่งหลายคน (admin) | ✅ |
| `POST` | `/push-notifications/send/topic` | ส่งไปยัง topic (admin) | ✅ |
| `POST` | `/push-notifications/test` | ทดสอบ push | ✅ |

### Service Status

**GET** `/push-notifications/status`

**Response:**
```json
{
  "available": true
}
```

### Register Device

**POST** `/push-notifications/devices/register`

**Request:**
```json
{
  "deviceToken": "fcm-token-here-xxx",
  "platform": "android",
  "deviceModel": "Samsung Galaxy S21",
  "osVersion": "13",
  "appVersion": "1.0.0"
}
```

**Response:**
```json
{
  "id": "uuid",
  "platform": "android",
  "deviceModel": "Samsung Galaxy S21",
  "appVersion": "1.0.0",
  "isActive": true,
  "lastActiveAt": "2024-03-21T10:30:00Z"
}
```

**Platform Values:** `ios` | `android` | `web`

### Get Registered Devices

**GET** `/push-notifications/devices`

**Response:**
```json
[
  {
    "id": "uuid",
    "platform": "android",
    "deviceModel": "Samsung Galaxy S21",
    "appVersion": "1.0.0",
    "isActive": true,
    "lastActiveAt": "2024-03-21T10:30:00Z"
  }
]
```

### Notification Preferences

**GET** `/push-notifications/preferences`

**Response:**
```json
{
  "bookingNotifications": true,
  "paymentNotifications": true,
  "reminderNotifications": true,
  "promotionalNotifications": false,
  "systemNotifications": true
}
```

**POST** `/push-notifications/preferences`

**Request:**
```json
{
  "bookingNotifications": true,
  "paymentNotifications": true,
  "reminderNotifications": true,
  "promotionalNotifications": false,
  "systemNotifications": true
}
```

### Send Push Notification (Admin)

**POST** `/push-notifications/send`

**Request:**
```json
{
  "userId": "user-uuid",
  "title": "การจองใหม่",
  "body": "คุณมีการจองใหม่ BK123456",
  "type": "booking",
  "data": {
    "bookingId": "booking-uuid",
    "action": "view_booking"
  },
  "imageUrl": "https://example.com/image.jpg",
  "actionUrl": "/bookings/booking-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "projects/xxx/messages/xxx"
}
```

**Notification Types:** `booking` | `payment` | `reminder` | `promotion` | `system` | `alert`

### Send Bulk Notification (Admin)

**POST** `/push-notifications/send/bulk`

**Request:**
```json
{
  "userIds": ["user-uuid-1", "user-uuid-2"],
  "title": "ประกาศ",
  "body": "มีประกาศใหม่จากระบบ",
  "type": "system"
}
```

**Response:**
```json
{
  "successCount": 2,
  "failureCount": 0
}
```

### Test Notification

**POST** `/push-notifications/test`

**Response:**
```json
{
  "success": true,
  "messageId": "projects/xxx/messages/xxx"
}
```

---

## Summary

### Total New API Endpoints: 66

| Module | Count | Priority |
|--------|:-----:|:--------:|
| Email Notification | 6 | P0 |
| PromptPay Payment | 5 | P0 |
| Reports Export | 5 | P0 |
| Two-Factor Auth | 6 | P1 |
| Audit Logging | 3 | P1 |
| Line Notify | 9 | P2 |
| i18n Translation | 8 | P2 |
| Database Performance | 5 | P3 |
| Mobile API | 10 | P3 |
| Push Notifications | 9 | P3 |

---

## Error Response Format

All APIs return errors in this format:

```json
{
  "statusCode": 400,
  "message": "Error message here",
  "error": "Bad Request"
}
```

### Common HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Too Many Requests |
| 500 | Internal Server Error |

---

## Rate Limiting

- Global: 100 requests per 60 seconds per IP
- Some endpoints may have additional limits

---

## Environment Variables Required

```env
# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Redis (for email queue)
REDIS_HOST=localhost
REDIS_PORT=6379

# PromptPay
PROMPTPAY_ID=0812345678

# Line Notify
LINE_NOTIFY_CLIENT_ID=xxx
LINE_NOTIFY_CLIENT_SECRET=xxx
LINE_NOTIFY_CALLBACK_URL=http://localhost:9011/line-notify/callback

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=xxx
FIREBASE_CLIENT_EMAIL=xxx
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
