# Staff Management API Workflow

ระบบการสร้างและจัดการพนักงานในโรลต่างๆ สำหรับผู้เช่าซื้อ (Tenant)

---

## Overview

ระบบนี้ใช้สถาปัตยกรรม **Multi-Tenant** ที่แยก data ของแต่ละโรงแรมออกจากกัน โดยผู้เช่าซื้อ (Tenant Admin) สามารถจัดการพนักงานในโรลต่างๆ ของตัวเองได้

---

## User Roles ในระบบ

### ระดับ Platform (SaaS Admin)
| Role | คำอธิบาย | Login Endpoint |
|------|----------|----------------|
| `platform_admin` | ดูแลระบบทั้งหมด, สิทธิ์สูงสุด | `POST /api/v1/auth/admin/login` |

### ระดับ Tenant (ผู้เช่าซื้อจัดการได้เอง)

#### ฝ่ายบริหาร / Back Office
| Role | คำอธิบาย | สิทธิ์หลัก |
|------|----------|-----------|
| `tenant_admin` | เจ้าของโรงแรม / ผู้ซื้อ subscription | จัดการทุกอย่างใน tenant ของตัวเอง |
| `manager` | ผู้จัดการโรงแรม | ดูรายงาน, สรุปยอด, สั่งอนุมัติ, จัดการพนักงาน |
| `accountant` | พนักงานบัญชี / การเงิน | บัญชี, รายรับรายจ่าย, รายงานภาษี |

#### ฝ่ายปฏิบัติการ / Front Office
| Role | คำอธิบาย | สิทธิ์หลัก |
|------|----------|-----------|
| `receptionist` | พนักงานต้อนรับ / Front Desk | เช็คอิน-เช็คเอาท์, จัดการห้อง, รับจอง |
| `housekeeper` | แม่บ้าน / Housekeeping | ตรวจสถานะห้อง, ทำความสะอาด |
| `chef` | เชฟ / หัวหน้าครัว | จัดการครัว, ออเดอร์, วัตถุดิบ |
| `waiter` | พนักงานเสิร์ฟ / F&B | บริการร้านอาหาร / Room Service |
| `maintenance` | ช่างซ่อมบำรุง | ซ่อมแซม, ตรวจระบบไฟฟ้า/แอร์/น้ำ |
| `security` | รปภ. / Security | ตรวจความปลอดภัย, กล้องวงจรปิด |

#### ทั่วไป
| Role | คำอธิบาย | สิทธิ์หลัก |
|------|----------|-----------|
| `staff` | พนักงานทั่วไป | สิทธิ์พื้นฐานตามหน้าที่ |
| `user` | ผู้ใช้ทั่วไป | สิทธิ์ขั้นต่ำ |

---

## API Endpoints

### 1. Authentication (การยืนยันตัวตน)

#### 1.1 สมัครสมาชิกใหม่ (เจ้าของโรงแรม)
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "firstName": "สมชาย",
  "lastName": "ใจดี",
  "email": "owner@myhotel.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "abc123...",
  "user": {
    "id": "uuid",
    "email": "owner@myhotel.com",
    "firstName": "สมชาย",
    "lastName": "ใจดี",
    "role": "tenant_admin",
    "tenantId": null,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

> **Note:** ผู้สมัครใหม่จะได้รับ role `tenant_admin` โดยอัตโนมัติ

#### 1.2 เข้าสู่ระบบ (Tenant Users)
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "staff@myhotel.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "abc123...",
  "user": {
    "id": "uuid",
    "email": "staff@myhotel.com",
    "firstName": "สมหญิง",
    "lastName": "รักงาน",
    "role": "receptionist",
    "tenantId": "tenant-uuid",
    "isPlatformAdmin": false
  }
}
```

#### 1.3 เข้าสู่ระบบ (Platform Admin)
```http
POST /api/v1/auth/admin/login
Content-Type: application/json

{
  "email": "admin@saas.com",
  "password": "admin123"
}
```

#### 1.4 รีเฟรช Token
```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "abc123..."
}
```

#### 1.5 ออกจากระบบ
```http
POST /api/v1/auth/logout
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "refreshToken": "abc123..."
}
```

---

### 2. User Management (จัดการผู้ใช้งานระบบ)

> **ใช้สำหรับ:** จัดการบัญชีผู้ใช้ที่สามารถ login เข้าระบบได้

#### 2.1 ดูรายการ Users ทั้งหมด
```http
GET /api/v1/users?page=1&limit=10&role=receptionist&search=สมหญิง
Authorization: Bearer {accessToken}
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | หน้าที่ต้องการ (default: 1) |
| `limit` | number | จำนวนต่อหน้า (default: 10) |
| `role` | string | กรองตาม role |
| `status` | string | กรองตามสถานะ (active/inactive) |
| `search` | string | ค้นหาชื่อหรืออีเมล |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "staff@myhotel.com",
      "firstName": "สมหญิง",
      "lastName": "รักงาน",
      "role": "receptionist",
      "status": "active",
      "tenantId": "tenant-uuid",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 10
}
```

**Roles ที่เข้าถึงได้:** `admin`, `tenant_admin`, `platform_admin`

#### 2.2 ดูข้อมูล User รายบุคคล
```http
GET /api/v1/users/{id}
Authorization: Bearer {accessToken}
```

**Roles ที่เข้าถึงได้:** `admin`, `tenant_admin`, `platform_admin`

#### 2.3 อัพเดทข้อมูล User
```http
PATCH /api/v1/users/{id}
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "firstName": "สมหญิง",
  "lastName": "ใจดีมาก",
  "role": "manager",
  "status": "active"
}
```

**Roles ที่เข้าถึงได้:** `admin`, `tenant_admin`, `platform_admin`

> **Note:** ไม่สามารถอัพเดท password ผ่าน endpoint นี้ได้ (ต้องใช้ password reset)

#### 2.4 ลบ User
```http
DELETE /api/v1/users/{id}
Authorization: Bearer {accessToken}
```

**Roles ที่เข้าถึงได้:** `admin`, `tenant_admin`, `platform_admin`

---

### 3. HR / Employee Management (จัดการข้อมูลพนักงาน)

> **ใช้สำหรับ:** จัดการข้อมูล HR ของพนักงาน (ไม่เกี่ยวกับ login)

#### 3.1 ดูรายการพนักงานทั้งหมด
```http
GET /api/v1/hr?page=1&limit=10&department=Reception&search=สมหญิง
Authorization: Bearer {accessToken}
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | หน้าที่ต้องการ (default: 1) |
| `limit` | number | จำนวนต่อหน้า (default: 10) |
| `department` | string | กรองตามแผนก |
| `position` | string | กรองตามตำแหน่ง |
| `search` | string | ค้นหาชื่อ, อีเมล, รหัสพนักงาน |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "tenant-uuid",
      "firstName": "สมหญิง",
      "lastName": "รักงาน",
      "email": "somying@myhotel.com",
      "employeeCode": "EMP001",
      "department": "Reception",
      "position": "Receptionist",
      "startDate": "2024-01-01",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 10
}
```

**Roles ที่เข้าถึงได้:** `admin`, `manager`, `tenant_admin`, `receptionist`, `platform_admin`, `staff`, `user`

#### 3.2 ดูข้อมูลพนักงานรายบุคคล
```http
GET /api/v1/hr/{id}
Authorization: Bearer {accessToken}
```

**Roles ที่เข้าถึงได้:** `admin`, `manager`, `tenant_admin`, `receptionist`, `platform_admin`, `staff`, `user`

#### 3.3 สร้างพนักงานใหม่
```http
POST /api/v1/hr
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "firstName": "สมหญิง",
  "lastName": "รักงาน",
  "email": "somying@myhotel.com",
  "employeeCode": "EMP001",
  "department": "Reception",
  "position": "Receptionist",
  "startDate": "2024-01-01"
}
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `firstName` | string | Yes | ชื่อ |
| `lastName` | string | Yes | นามสกุล |
| `email` | string | Yes | อีเมล (unique) |
| `employeeCode` | string | No | รหัสพนักงาน (unique) |
| `department` | string | No | แผนก |
| `position` | string | No | ตำแหน่ง |
| `startDate` | date | No | วันที่เริ่มงาน |

**Response:**
```json
{
  "id": "uuid",
  "tenantId": "tenant-uuid",
  "firstName": "สมหญิง",
  "lastName": "รักงาน",
  "email": "somying@myhotel.com",
  "employeeCode": "EMP001",
  "department": "Reception",
  "position": "Receptionist",
  "startDate": "2024-01-01T00:00:00.000Z",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Roles ที่เข้าถึงได้:** `admin`, `manager`, `tenant_admin`, `platform_admin`

#### 3.4 อัพเดทข้อมูลพนักงาน
```http
PATCH /api/v1/hr/{id}
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "department": "Front Office",
  "position": "Senior Receptionist"
}
```

**Roles ที่เข้าถึงได้:** `admin`, `manager`, `tenant_admin`, `platform_admin`

#### 3.5 ลบพนักงาน
```http
DELETE /api/v1/hr/{id}
Authorization: Bearer {accessToken}
```

**Roles ที่เข้าถึงได้:** `admin`, `tenant_admin`, `platform_admin`

---

## Workflow Diagrams

### Workflow 1: เจ้าของโรงแรมสมัครและสร้างทีมงาน

```
┌─────────────────────────────────────────────────────────────────┐
│                    Hotel Owner Registration                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. POST /auth/register                                         │
│     ├── สร้าง User ใหม่ (role: tenant_admin)                    │
│     └── Return: accessToken + refreshToken                      │
│                                                                 │
│  2. สร้าง Tenant (Hotel) - ผ่านระบบ Subscription                │
│     └── User.tenantId = tenant.id                               │
│                                                                 │
│  3. POST /hr (สร้างข้อมูลพนักงาน HR)                            │
│     └── สร้าง Employee record                                   │
│                                                                 │
│  4. สร้าง User Account สำหรับพนักงาน (ถ้าต้องการให้ login ได้)  │
│     └── PATCH /users/{id} กำหนด role ที่เหมาะสม                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow 2: การจัดการพนักงานในแต่ละแผนก

```
┌─────────────────────────────────────────────────────────────────┐
│              Staff Management by Department                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │  Back Office     │    │  Front Office    │                   │
│  ├──────────────────┤    ├──────────────────┤                   │
│  │ • tenant_admin   │    │ • receptionist   │                   │
│  │ • manager        │    │ • housekeeper    │                   │
│  │ • accountant     │    │ • chef           │                   │
│  │                  │    │ • waiter         │                   │
│  │                  │    │ • maintenance    │                   │
│  │                  │    │ • security       │                   │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                 │
│  Workflow:                                                      │
│  1. tenant_admin/manager สร้าง Employee ผ่าน POST /hr           │
│  2. กำหนด department และ position                               │
│  3. (Optional) สร้าง User account พร้อม role ที่เหมาะสม         │
│  4. พนักงาน login ผ่าน POST /auth/login                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Workflow 3: การเข้าถึงตามสิทธิ์ (Role-Based Access)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Role-Based Access Control                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ platform_admin  │ ──► ดูข้อมูลทุก tenant (ไม่มี tenantId)    │
│  └─────────────────┘                                            │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ tenant_admin    │ ──► จัดการทุกอย่างใน tenant ตัวเอง         │
│  │ manager         │     (filter by tenantId)                   │
│  └─────────────────┘                                            │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ receptionist    │ ──► ดูข้อมูล + จัดการงาน Front Desk        │
│  │ housekeeper     │ ──► ดูข้อมูล + จัดการงาน Housekeeping      │
│  │ chef            │ ──► ดูข้อมูล + จัดการงาน Kitchen           │
│  │ waiter          │ ──► ดูข้อมูล + จัดการงาน F&B               │
│  │ maintenance     │ ──► ดูข้อมูล + จัดการงาน Maintenance       │
│  │ security        │ ──► ดูข้อมูล + จัดการงาน Security          │
│  │ accountant      │ ──► ดูข้อมูล + จัดการงาน Finance           │
│  └─────────────────┘                                            │
│                                                                 │
│  ┌─────────────────┐                                            │
│  │ staff / user    │ ──► สิทธิ์พื้นฐาน (ดูข้อมูลเท่านั้น)       │
│  └─────────────────┘                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Department & Position Reference

### แผนกที่แนะนำ (Departments)

| Department Code | ชื่อแผนก (TH) | ชื่อแผนก (EN) |
|-----------------|---------------|---------------|
| `front_office` | ส่วนหน้า | Front Office |
| `housekeeping` | แม่บ้าน | Housekeeping |
| `fnb` | อาหารและเครื่องดื่ม | Food & Beverage |
| `kitchen` | ครัว | Kitchen |
| `engineering` | วิศวกรรม/ช่าง | Engineering |
| `security` | รักษาความปลอดภัย | Security |
| `hr` | ทรัพยากรบุคคล | Human Resources |
| `finance` | การเงิน | Finance |
| `sales` | ขาย/การตลาด | Sales & Marketing |
| `it` | เทคโนโลยีสารสนเทศ | IT Support |
| `spa` | สปา/เวลเนส | Spa & Wellness |
| `events` | จัดงาน | Events |

### ตำแหน่งตามแผนก (Positions)

#### Front Office
- Receptionist / พนักงานต้อนรับ
- Front Desk Manager / หัวหน้าส่วนหน้า
- Concierge / พนักงานบริการแขก
- Night Auditor / พนักงานตรวจสอบกะกลางคืน
- Bellboy / พนักงานยกกระเป๋า

#### Housekeeping
- Room Attendant / พนักงานทำความสะอาดห้อง
- Housekeeping Supervisor / หัวหน้าแม่บ้าน
- Laundry Staff / พนักงานซักรีด
- Public Area Cleaner / พนักงานทำความสะอาดพื้นที่ส่วนกลาง

#### F&B / Kitchen
- Head Chef / หัวหน้าเชฟ
- Sous Chef / รองหัวหน้าเชฟ
- Line Cook / พ่อครัว
- Waiter / พนักงานเสิร์ฟ
- Bartender / พนักงานบาร์
- F&B Manager / ผู้จัดการอาหารและเครื่องดื่ม

#### Engineering
- Chief Engineer / หัวหน้าช่าง
- Maintenance Technician / ช่างซ่อมบำรุง
- HVAC Technician / ช่างแอร์
- Electrician / ช่างไฟฟ้า
- Plumber / ช่างประปา

#### Security
- Security Manager / ผู้จัดการรักษาความปลอดภัย
- Security Guard / เจ้าหน้าที่รักษาความปลอดภัย
- CCTV Operator / เจ้าหน้าที่ควบคุมกล้องวงจรปิด

---

## Error Codes

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `BAD_REQUEST` | ข้อมูลไม่ถูกต้อง |
| 401 | `UNAUTHORIZED` | ไม่ได้ login หรือ token หมดอายุ |
| 403 | `FORBIDDEN` | ไม่มีสิทธิ์เข้าถึง |
| 404 | `NOT_FOUND` | ไม่พบข้อมูล |
| 409 | `CONFLICT` | ข้อมูลซ้ำ (เช่น email ซ้ำ) |
| 500 | `INTERNAL_ERROR` | ข้อผิดพลาดภายในระบบ |

---

## Security Notes

1. **JWT Token** - Access token หมดอายุใน 15 นาที, ใช้ refresh token ต่ออายุ
2. **Rate Limiting** - Login มี limit 10 requests/minute, Register มี limit 5 requests/minute
3. **Tenant Isolation** - ข้อมูลแยกตาม tenantId, ผู้ใช้เห็นเฉพาะข้อมูลของ tenant ตัวเอง
4. **Password** - ไม่ส่ง password ใน response, ใช้ bcrypt hash

---

## API Base URL

```
Production: https://api.yourhotel.com/api/v1
Development: http://localhost:3000/api/v1
```

---

## Related Documentation

- [Authentication Guide](./auth-guide.md)
- [Multi-Tenant Architecture](./multi-tenant.md)
- [API Reference (Swagger)](http://localhost:3000/api/docs)
