# Admin Plans API Documentation

## Overview
Admin Plans API เป็น API สำหรับจัดการแผนบริการ (Subscription Plans) ในระบบ StaySync โดยเฉพาะสำหรับ Platform Admin

## Authentication & Authorization
- **Authentication**: JWT Bearer Token
- **Authorization**: ต้องมี role `platform_admin` เท่านั้น

## Base URL
```
/api/v1/admin/plans
```

## API Endpoints

### 1. Get All Plans
ดึงรายการแผนบริการทั้งหมด พร้อมสถิติ

**Endpoint**: `GET /api/v1/admin/plans`

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "uuid-1234",
      "code": "S",
      "name": "Small Plan",
      "priceMonthly": 1490,
      "maxRooms": 20,
      "maxUsers": 3,
      "isActive": true,
      "subscriptionCount": 12,
      "featureCount": 5
    },
    {
      "id": "uuid-5678",
      "code": "M",
      "name": "Medium Plan",
      "priceMonthly": 2990,
      "maxRooms": 50,
      "maxUsers": 10,
      "isActive": true,
      "subscriptionCount": 8,
      "featureCount": 8
    }
  ],
  "total": 2
}
```

**Error Responses**:
- `401 Unauthorized` - ไม่มี token หรือ token ไม่ถูกต้อง
- `403 Forbidden` - ไม่มีสิทธิ์ platform_admin

---

### 2. Get Plan by ID
ดึงข้อมูลแผนบริการตาม ID พร้อมรายละเอียดฟีเจอร์

**Endpoint**: `GET /api/v1/admin/plans/:id`

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
```

**URL Parameters**:
- `id` (UUID) - Plan ID

**Response** (200 OK):
```json
{
  "id": "uuid-1234",
  "code": "M",
  "name": "Medium Plan",
  "priceMonthly": 2990,
  "maxRooms": 50,
  "maxUsers": 10,
  "isActive": true,
  "planFeatures": [
    {
      "id": "pf-uuid-1",
      "featureCode": "extra-analytics",
      "featureName": "Extra Analytics",
      "priceMonthly": 990
    },
    {
      "id": "pf-uuid-2",
      "featureCode": "advanced-reporting",
      "featureName": "Advanced Reporting",
      "priceMonthly": 1490
    }
  ],
  "subscriptionCount": 8
}
```

**Error Responses**:
- `401 Unauthorized` - ไม่มี token หรือ token ไม่ถูกต้อง
- `403 Forbidden` - ไม่มีสิทธิ์ platform_admin
- `404 Not Found` - ไม่พบแผนบริการ

---

### 3. Create New Plan
สร้างแผนบริการใหม่

**Endpoint**: `POST /api/v1/admin/plans`

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body**:
```json
{
  "code": "L",
  "name": "Large Plan",
  "priceMonthly": 4990,
  "maxRooms": 100,
  "maxUsers": 20,
  "isActive": true
}
```

**Field Validation**:
- `code` (required): ต้องไม่ซ้ำกับแผนที่มีอยู่แล้ว, ความยาว 1-10 ตัวอักษร
- `name` (required): ชื่อแผนบริการ
- `priceMonthly` (required): ราคาต่อเดือน (>= 0)
- `maxRooms` (required): จำนวนห้องสูงสุด (>= 1)
- `maxUsers` (required): จำนวนผู้ใช้สูงสุด (>= 1)
- `isActive` (optional): สถานะ active/inactive, default = true

**Response** (201 Created):
```json
{
  "id": "uuid-9999",
  "code": "L",
  "name": "Large Plan",
  "priceMonthly": 4990,
  "maxRooms": 100,
  "maxUsers": 20,
  "isActive": true,
  "planFeatures": [],
  "subscriptionCount": 0
}
```

**Error Responses**:
- `400 Bad Request` - ข้อมูลไม่ถูกต้อง (validation failed)
- `401 Unauthorized` - ไม่มี token หรือ token ไม่ถูกต้อง
- `403 Forbidden` - ไม่มีสิทธิ์ platform_admin
- `409 Conflict` - Plan code ซ้ำกับที่มีอยู่แล้ว

**Example Error (409)**:
```json
{
  "statusCode": 409,
  "message": "Plan with code \"L\" already exists",
  "error": "Conflict"
}
```

---

### 4. Update Plan
อัพเดทข้อมูลแผนบริการ

**Endpoint**: `PATCH /api/v1/admin/plans/:id`

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**URL Parameters**:
- `id` (UUID) - Plan ID

**Request Body** (ทุกฟิลด์เป็น optional):
```json
{
  "name": "Medium Plan (Updated)",
  "priceMonthly": 3490,
  "maxRooms": 60,
  "maxUsers": 12,
  "isActive": true
}
```

**⚠️ Warning**: การลดค่า `maxRooms` หรือ `maxUsers` อาจส่งผลกระทบต่อ subscriptions ที่ active อยู่

**Response** (200 OK):
```json
{
  "id": "uuid-1234",
  "code": "M",
  "name": "Medium Plan (Updated)",
  "priceMonthly": 3490,
  "maxRooms": 60,
  "maxUsers": 12,
  "isActive": true,
  "planFeatures": [...],
  "subscriptionCount": 8
}
```

**Error Responses**:
- `400 Bad Request` - ข้อมูลไม่ถูกต้อง
- `401 Unauthorized` - ไม่มี token หรือ token ไม่ถูกต้อง
- `403 Forbidden` - ไม่มีสิทธิ์ platform_admin
- `404 Not Found` - ไม่พบแผนบริการ

---

### 5. Delete Plan (Soft Delete)
ลบแผนบริการ (soft delete โดยการตั้ง isActive = false)

**Endpoint**: `DELETE /api/v1/admin/plans/:id`

**Request Headers**:
```
Authorization: Bearer <JWT_TOKEN>
```

**URL Parameters**:
- `id` (UUID) - Plan ID

**⚠️ Important**: ไม่สามารถลบแผนที่มี active subscriptions ได้

**Response** (200 OK):
```json
{
  "message": "Plan \"Medium Plan\" deleted successfully"
}
```

**Error Responses**:
- `400 Bad Request` - แผนมี active subscriptions อยู่
  ```json
  {
    "statusCode": 400,
    "message": "Cannot delete plan \"Medium Plan\" because it has 8 active subscription(s). Please deactivate it instead.",
    "error": "Bad Request"
  }
  ```
- `401 Unauthorized` - ไม่มี token หรือ token ไม่ถูกต้อง
- `403 Forbidden` - ไม่มีสิทธิ์ platform_admin
- `404 Not Found` - ไม่พบแผนบริการ

---

## Security Features

### 1. Authentication (JWT)
ทุก endpoint ต้องมี JWT token ใน Authorization header
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. Role-Based Access Control
ต้องมี role `platform_admin` เท่านั้นถึงจะเข้าถึง API นี้ได้

### 3. Input Validation
- ตรวจสอบ data type และ format
- ตรวจสอบ business rules (maxRooms > 0, priceMonthly >= 0)
- ป้องกัน duplicate plan codes

### 4. Business Logic Protection
- ไม่อนุญาตให้ลบแผนที่มี active subscriptions
- แจ้งเตือนเมื่อ reduce limits ของแผนที่มี active subscriptions
- Soft delete เพื่อรักษาข้อมูล historical

---

## Error Handling

ทุก API จะส่ง error ในรูปแบบ:
```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Error Type"
}
```

**Common Error Types**:
- `400 Bad Request` - ข้อมูลไม่ถูกต้องหรือ validation failed
- `401 Unauthorized` - ไม่มี token หรือ token expired
- `403 Forbidden` - ไม่มีสิทธิ์เข้าถึง
- `404 Not Found` - ไม่พบข้อมูลที่ต้องการ
- `409 Conflict` - ข้อมูลซ้ำ (duplicate)

---

## Logging

Service จะ log ทุก action สำคัญ:
- ✅ Created plan: {name} ({code})
- ✅ Updated plan: {name} ({code})
- ✅ Deleted plan: {name} ({code})
- ⚠️ Warning เมื่อ reduce limits ของ plan ที่มี active subscriptions

---

## Testing with Postman

สามารถ import [Postman Collection](../../postman/StaySync_Admin_Panel_API.postman_collection.json) เพื่อทดสอบ API

### Quick Test Steps:
1. เข้าสู่ระบบด้วย platform_admin account
2. Copy JWT token
3. Set Bearer token ใน Postman
4. ทดสอบ endpoints ตามลำดับ:
   - GET all plans
   - GET plan by ID
   - POST create new plan
   - PATCH update plan
   - DELETE plan

---

## Example Usage

### สร้างแผนใหม่ทั้ง 3 ระดับ

```bash
# Small Plan
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "S",
    "name": "Small Plan",
    "priceMonthly": 1490,
    "maxRooms": 20,
    "maxUsers": 3,
    "isActive": true
  }'

# Medium Plan
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "M",
    "name": "Medium Plan",
    "priceMonthly": 2990,
    "maxRooms": 50,
    "maxUsers": 10,
    "isActive": true
  }'

# Large Plan
curl -X POST http://localhost:3000/api/v1/admin/plans \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "L",
    "name": "Large Plan",
    "priceMonthly": 4990,
    "maxRooms": 100,
    "maxUsers": 20,
    "isActive": true
  }'
```

---

## Related APIs
- [Admin Features API](./ADMIN_FEATURES_API.md) - จัดการฟีเจอร์เสริม
- [Admin Subscriptions API](./ADMIN_SUBSCRIPTIONS_API.md) - จัดการ subscriptions

---

## Support
หากพบปัญหาหรือมีคำถาม กรุณาติดต่อทีมพัฒนา
