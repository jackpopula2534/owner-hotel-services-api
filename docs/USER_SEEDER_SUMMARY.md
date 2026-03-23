# User Seeder Summary - Owner Hotel Services

## สรุป

ระบบนี้ใช้ **Backend API แยก (NestJS)** ที่ `http://localhost:9011/api/v1`

---

## ⚠️ สำคัญ: Backend Configuration

```
Frontend (Next.js)  →  Backend (NestJS API)  →  Database (MySQL)
Port 3000              Port 9011                Port 8889
```

**Test Accounts จะใช้ได้ก็ต่อเมื่อ:**
1. ✅ Backend Server รันอยู่ที่ port 9011
2. ✅ Database ถูก Seed แล้ว

---

## วิธีสร้าง User (เลือกวิธีใดวิธีหนึ่ง)

### วิธีที่ 1: Register ผ่านหน้า UI (แนะนำ)

1. ไปที่ `http://localhost:3000/register`
2. กรอกข้อมูล 3 Steps:
   - Step 1: Email, Password, ชื่อ-นามสกุล
   - Step 2: ข้อมูลโรงแรม
   - Step 3: ยืนยันและรับ Trial 14 วัน
3. ใช้ Dev Auto-Fill ได้ (ถ้าเปิด `NEXT_PUBLIC_ENABLE_DEV_AUTOFILL=true`)

**Default Password จาก Auto-Fill:** `Password123!`

### วิธีที่ 2: Seed Database ที่ Backend

```bash
# ที่ Backend Project (ถ้ามี)
cd hotel-api

# Seed Database
npx prisma db seed
# หรือ
npm run seed
```

### วิธีที่ 3: สร้างผ่าน API โดยตรง

```bash
# Register User ใหม่
curl -X POST http://localhost:9011/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123!",
    "firstName": "Test",
    "lastName": "User"
  }'
```

---

## Test Accounts (ต้อง Seed ก่อน)

รัน `npm run seed` ที่ Backend เพื่อสร้าง Accounts เหล่านี้

> **สำคัญ:** ระบบแยก Login 2 ช่องทางอย่างชัดเจน
> - **Platform Admin** → ใช้ `POST /api/v1/auth/admin/login` เท่านั้น (Admin table)
> - **Subscription Customers** → ใช้ `POST /api/v1/auth/login` เท่านั้น (User table)
> - Role `platform_admin`, `super_admin`, `admin` **ไม่สามารถ** login ผ่าน `/auth/login` ได้

### Platform Admin Accounts (Login ผ่าน POST /api/v1/auth/admin/login เท่านั้น)

| Role | Email | Password | Table |
|------|-------|----------|-------|
| **Platform Admin** | `admin@hotelservices.com` | `Admin@123` | Admin |
| **Platform Admin** | `finance@hotelservices.com` | `Finance@123` | Admin |
| **Platform Admin** | `support@hotelservices.com` | `Support@123` | Admin |

### Hotel Owner Accounts - Subscription Customers (Login ผ่าน POST /api/v1/auth/login)

| Role | Email | Password | โรงแรม |
|------|-------|----------|--------|
| **Tenant Admin** | `somchai@email.com` | `password123` | โรงแรมสุขใจ |
| **Tenant Admin** | `mountain@email.com` | `password123` | Mountain View Resort |
| **Tenant Admin** | `seaside@email.com` | `password123` | บ้านพักริมทะเล |
| **Tenant Admin** | `garden@email.com` | `password123` | Garden Resort & Spa |

### Hotel Staff Accounts - Subscription Customers (Login ผ่าน POST /api/v1/auth/login)

| Role | Email Pattern | Password | Level |
|------|--------------|----------|-------|
| **Manager** | `manager*.hotel.test` | `Staff@123` | 80 |
| **HR** | `hr*.hotel.test` | `Staff@123` | 70 |
| **Chef** | `chef*.hotel.test` | `Staff@123` | 60 |
| **Receptionist** | `receptionist*.hotel.test` | `Staff@123` | 50 |
| **Waiter** | `waiter*.hotel.test` | `Staff@123` | 50 |
| **Housekeeper** | `housekeeper*.hotel.test` | `Staff@123` | 40 |
| **Maintenance** | `maintenance*.hotel.test` | `Staff@123` | 40 |
| **Accountant** | `accountant*.hotel.test` | `Staff@123` | 40 |
| **Security** | `security*.hotel.test` | `Staff@123` | 40 |

> Staff accounts จะถูกสร้างให้แต่ละโรงแรมโดยอัตโนมัติ

---

## User ที่ใช้งานได้จริง (Register เอง)

| วิธีสร้าง | Role ที่ได้ | หมายเหตุ |
|----------|------------|----------|
| Register ผ่าน UI | `tenant_admin` | เจ้าของโรงแรม + Trial 14 วัน |
| Dev Auto-Fill | `tenant_admin` | Password: `Password123!` |

---

## User Flow System Diagram

### 1. Authentication Flow (การ Login/Register)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTHENTICATION FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   Landing    │
                              │    Page      │
                              └──────┬───────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
            ┌──────────────┐                 ┌──────────────┐
            │    Login     │                 │   Register   │
            │    Page      │                 │    Page      │
            └──────┬───────┘                 └──────┬───────┘
                   │                                │
                   │                    ┌───────────┴───────────┐
                   │                    ▼                       ▼
                   │           ┌──────────────┐        ┌──────────────┐
                   │           │   Step 1:    │        │   Step 2:    │
                   │           │  User Info   │───────▶│  Hotel Info  │
                   │           │  (Email,     │        │  (Name,      │
                   │           │   Password)  │        │   Address)   │
                   │           └──────────────┘        └──────┬───────┘
                   │                                          │
                   │                                          ▼
                   │                                  ┌──────────────┐
                   │                                  │   Step 3:    │
                   │                                  │  Promotion   │
                   │                                  │   (Trial)    │
                   │                                  └──────┬───────┘
                   │                                          │
                   └────────────────┬─────────────────────────┘
                                    ▼
                           ┌──────────────┐
                           │   Backend    │
                           │  Auth API    │
                           └──────┬───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
            ┌──────────────┐            ┌──────────────┐
            │   Success    │            │    Error     │
            │  ─────────── │            │  ─────────── │
            │  JWT Token   │            │  Show Error  │
            │  + Redirect  │            │   Message    │
            └──────┬───────┘            └──────────────┘
                   │
                   ▼
           ┌──────────────┐
           │  Dashboard   │
           │   (Based on  │
           │    Role)     │
           └──────────────┘
```

### 2. Role-Based Access Flow (การเข้าถึงตาม Role)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ROLE-BASED ACCESS FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │ Authenticated│
                              │     User     │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ Check Role   │
                              │  & Permissions│
                              └──────┬───────┘
                                     │
        ┌────────────┬───────────────┼───────────────┬────────────┐
        ▼            ▼               ▼               ▼            ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│  Platform   ││   Tenant    ││   Manager   ││     HR      ││    Staff    │
│   Admin     ││   Admin     ││             ││             ││             │
│ (Level 1000)││ (Level 85)  ││ (Level 80)  ││ (Level 70)  ││ (Level 30)  │
└──────┬──────┘└──────┬──────┘└──────┬──────┘└──────┬──────┘└──────┬──────┘
       │              │              │              │              │
       ▼              ▼              ▼              ▼              ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│• All System ││• All Hotel  ││• Bookings   ││• Employees  ││• View Own   │
│• All Tenants││• Settings   ││• Reports    ││• Payroll    ││  Schedule   │
│• Billing    ││• Employees  ││• Check-in/  ││• Leave Mgmt ││• Tasks      │
│• Subscription││• Reports   ││  Check-out  ││• Attendance ││• Profile    │
└─────────────┘└─────────────┘└─────────────┘└─────────────┘└─────────────┘
```

### 3. Department Roles Flow (บทบาทตามแผนก)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DEPARTMENT ROLES FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌───────────────────────┐
                         │     Hotel System      │
                         └───────────┬───────────┘
                                     │
       ┌─────────────┬───────────────┼───────────────┬─────────────┐
       ▼             ▼               ▼               ▼             ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│  RESTAURANT ││    ROOMS    ││HOUSEKEEPING ││ MAINTENANCE ││   FRONT     │
│   MODULE    ││   MODULE    ││   MODULE    ││   MODULE    ││   DESK      │
└──────┬──────┘└──────┬──────┘└──────┬──────┘└──────┬──────┘└──────┬──────┘
       │              │              │              │              │
       ▼              ▼              ▼              ▼              ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│    CHEF     ││  ROOM MGMT  ││ HOUSEKEEPER ││ MAINTENANCE ││RECEPTIONIST │
│   (Lv.60)   ││             ││   (Lv.40)   ││   (Lv.40)   ││   (Lv.50)   │
├─────────────┤│             │├─────────────┤├─────────────┤├─────────────┤
│• Menu Mgmt  ││             ││• Tasks List ││• Requests   ││• Check-in   │
│• Kitchen    ││             ││• Room Status││• Repair Log ││• Check-out  │
│• Stock      ││             ││• Report     ││• Equipment  ││• Bookings   │
└─────────────┘│             │└─────────────┘└─────────────┘└─────────────┘
       │       │             │
       ▼       │             │
┌─────────────┐│             │
│   WAITER    ││             │
│   (Lv.50)   ││             │
├─────────────┤│             │
│• Take Orders││             │
│• Table Mgmt ││             │
│• Billing    ││             │
└─────────────┘└─────────────┘
```

### 4. Complete User Journey Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE USER JOURNEY                                 │
└─────────────────────────────────────────────────────────────────────────────┘

  NEW USER                    REGISTERED USER                  DAILY OPERATIONS
  ────────                    ───────────────                  ─────────────────

┌─────────┐                  ┌─────────────┐                  ┌─────────────┐
│  Visit  │                  │    Login    │                  │  Dashboard  │
│ Website │                  │    Page     │                  │    Home     │
└────┬────┘                  └──────┬──────┘                  └──────┬──────┘
     │                              │                                │
     ▼                              ▼                                ▼
┌─────────┐                  ┌─────────────┐                  ┌─────────────┐
│Register │                  │   Enter     │                  │  Select     │
│  Step 1 │                  │ Credentials │                  │  Property   │
│(Account)│                  └──────┬──────┘                  └──────┬──────┘
└────┬────┘                         │                                │
     │                              ▼                                ▼
     ▼                        ┌─────────────┐                  ┌─────────────┐
┌─────────┐                  │  Validate   │                  │   Access    │
│Register │                  │    Token    │                  │   Module    │
│  Step 2 │                  └──────┬──────┘                  │(Based Role) │
│ (Hotel) │                         │                         └──────┬──────┘
└────┬────┘                         │                                │
     │                              │         ┌──────────────────────┼──────────────────────┐
     ▼                              │         │                      │                      │
┌─────────┐                         │         ▼                      ▼                      ▼
│Register │                         │   ┌──────────┐          ┌──────────┐          ┌──────────┐
│  Step 3 │                         │   │ Bookings │          │    HR    │          │Restaurant│
│(Promo)  │                         │   │  Module  │          │  Module  │          │  Module  │
└────┬────┘                         │   └──────────┘          └──────────┘          └──────────┘
     │                              │         │                      │                      │
     └──────────────────────────────┘         ▼                      ▼                      ▼
                                        ┌──────────┐          ┌──────────┐          ┌──────────┐
                                        │• View    │          │• Employees│          │• Orders  │
                                        │• Create  │          │• Payroll │          │• Kitchen │
                                        │• Update  │          │• Leave   │          │• Menu    │
                                        │• Reports │          │• Attendance│         │• Tables  │
                                        └──────────┘          └──────────┘          └──────────┘
```

---

## User Roles (บทบาทผู้ใช้ในระบบ)

### Role Hierarchy (ลำดับความสำคัญ)

```
Level 1000  ┌─────────────────┐  Platform Admin (SaaS ทั้งระบบ)
            └────────┬────────┘
                     │
Level 100   ┌─────────────────┐  Super Admin (Legacy)
            └────────┬────────┘
                     │
Level 85-90 ┌─────────────────┐  Tenant Admin / Admin (เจ้าของโรงแรม)
            └────────┬────────┘
                     │
Level 80    ┌─────────────────┐  Manager (ผู้จัดการ)
            └────────┬────────┘
                     │
Level 70    ┌─────────────────┐  HR (ฝ่ายบุคคล)
            └────────┬────────┘
                     │
Level 50-60 ┌─────────────────┐  Chef, Waiter, Receptionist
            └────────┬────────┘
                     │
Level 40    ┌─────────────────┐  Housekeeper, Maintenance
            └────────┬────────┘
                     │
Level 30    ┌─────────────────┐  Staff (พนักงานทั่วไป)
            └────────┬────────┘
                     │
Level 10    ┌─────────────────┐  User (ผู้ใช้ทั่วไป)
            └─────────────────┘
```

### รายละเอียดแต่ละ Role (Implemented in RolesGuard)

#### Admin Roles (Admin Table → `/auth/admin/login` เท่านั้น)

| Role | Level | คำอธิบาย | หน้าที่หลัก |
|------|-------|----------|-------------|
| `platform_admin` | 1000 | SaaS Platform Admin | จัดการทุกอย่างในระบบ, ดูแล Tenants ทั้งหมด |
| `super_admin` | 100 | Super Admin (Legacy) | รองรับค่าเดิม (backward compatibility) |
| `admin` | 90 | Legacy Admin | รองรับค่าเดิม (backward compatibility) |

> **Admin roles ห้าม login ผ่าน `/auth/login`** - ต้องใช้ `/auth/admin/login` เท่านั้น

#### Subscription Customer Roles (User Table → `/auth/login`)

| Role | Level | คำอธิบาย | หน้าที่หลัก |
|------|-------|----------|-------------|
| `tenant_admin` | 85 | Hotel Owner | เจ้าของโรงแรม, จัดการพนักงาน, ดูรายงาน |
| `manager` | 80 | Hotel Manager | ผู้จัดการ, Bookings, รายงาน |
| `hr` | 70 | Human Resources | จัดการพนักงาน, Employee CRUD |
| `chef` | 60 | หัวหน้าครัว | Restaurant, Kitchen |
| `receptionist` | 50 | พนักงานต้อนรับ | Check-in/out, Bookings |
| `waiter` | 50 | พนักงานเสิร์ฟ | Restaurant, Service |
| `housekeeper` | 40 | แม่บ้าน | Housekeeping Tasks, สถานะห้อง |
| `maintenance` | 40 | ช่างซ่อมบำรุง | Maintenance Requests |
| `accountant` | 40 | บัญชี | Finance, Payments |
| `security` | 40 | รปภ. | Security |
| `staff` | 30 | พนักงานทั่วไป | สิทธิ์พื้นฐาน |
| `user` | 10 | ผู้ใช้ทั่วไป | View only |

> **Role Hierarchy**: Role ที่มี Level สูงกว่าจะสามารถเข้าถึง endpoint ของ Role ที่มี Level ต่ำกว่าได้อัตโนมัติ
> เช่น `manager` (Level 80) สามารถเข้าถึง endpoint ที่ต้องการ `receptionist` (Level 50) ได้
> **แต่** subscription customer roles ไม่สามารถเข้าถึง admin routes (`/admin/*`, `/admin-panel/*`) ได้

---

## Development Auto-Fill

### การเปิดใช้งาน

```env
NEXT_PUBLIC_ENABLE_DEV_AUTOFILL=true
```

### ข้อมูลที่ Generate ได้

| Field | ตัวอย่าง |
|-------|---------|
| firstName | สมชาย, วิชัย, ประเสริฐ |
| lastName | ใจดี, มั่นคง, รุ่งเรือง |
| email | user[timestamp]@example.com |
| phone | 081-234-5678 |
| password | `Password123!` |
| hotelName | Grand Hotel 42 |

---

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | คำอธิบาย |
|------|----------|
| `lib/stores/authStore.ts` | Role hierarchy และ Authentication |
| `lib/utils/devHelpers.ts` | Auto-fill random data functions |
| `README.md` | Test Accounts หลัก |

---

## คำสั่ง Seed Database (ที่ Backend)

```bash
# Generate Prisma Client
npx prisma generate

# Push Schema to Database
npx prisma db push

# Seed Test Data (รวม Test Users)
npx prisma db seed
```

หลังจากรันคำสั่งข้างบนแล้ว จะสามารถใช้ Test Accounts ด้านบนได้เลย
