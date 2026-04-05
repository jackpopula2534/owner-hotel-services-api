# Technical Design Document
## HR Add-on Module — Staff ↔ Employee Integration (StaySync)

**Version:** 1.0
**Date:** 2026-04-05
**Author:** StaySync Engineering
**Status:** Draft
**Reviewers:** Product, Backend, Frontend

---

## 1. Overview

### 1.1 Goal

ออกแบบระบบ HR Module ในรูปแบบ **Paid Add-on** ที่สามารถขายแยกจาก package ปกติได้ โดย:

- **Base package:** Staff CRUD ทำงานได้อิสระ (แม่บ้าน/ช่างซ่อม) — รวมอยู่ในทุก plan
- **HR Add-on:** ระบบ HR เต็มรูปแบบ (Employee, Attendance, Leave, Payroll) — ซื้อเพิ่ม
- **เมื่อ HR Add-on active:** Staff สามารถ link ↔ Employee ได้ — ใช้ HR เป็น source of truth สำหรับข้อมูลคน

### 1.2 Background

ปัจจุบันมี 2 โมเดลที่ทำงานแยกกันสมบูรณ์:

| โมเดล | ตาราง | หน้าที่ | ปัญหา |
|-------|-------|---------|-------|
| `Staff` | `staff` | Operations (แม่บ้าน/ช่าง) | ข้อมูลซ้ำกับ Employee |
| `Employee` | `employees` | HR (ลา, เงินเดือน, attendance) | ไม่ link กับ Staff |

ไม่มี FK เชื่อมกัน → ข้อมูลคนเดียวกันอยู่ 2 ที่, ไม่ sync, ไม่รู้ว่าช่างคนนี้ใน Staff คือพนักงานคนไหนใน HR

### 1.3 Out of Scope

- การ migrate ข้อมูลเก่าจาก Staff → Employee (ทำแยก)
- Single Sign-On กับ HR ภายนอก
- Payroll คำนวณอัตโนมัติ (ทำ Phase 2)
- Mobile app HR features

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    StaySync Backend                      │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │   Staff Module   │    │      HR Module           │   │
│  │  (Base Package)  │    │   (Paid Add-on only)     │   │
│  │                  │    │                          │   │
│  │  GET/POST/PATCH  │    │  Employee CRUD           │   │
│  │  DELETE /staff   │    │  Attendance              │   │
│  │  No guard needed │    │  Leave Management        │   │
│  │                  │    │  Payroll                 │   │
│  │  /staff/:id      │    │  @UseGuards(HrAddonGuard)│   │
│  │  /link-employee  │◄──►│                          │   │
│  │  [HrAddonGuard]  │    │  POST /hr/:id/           │   │
│  └──────────────────┘    │  create-staff            │   │
│           │              └──────────────────────────┘   │
│           │ employeeId FK                                │
│           ▼                                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │              AddonService                        │   │
│  │  hasActiveAddon(tenantId, 'HR_MODULE') → bool    │   │
│  │  Uses: subscriptions + subscription_features     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.1 Feature Gating Flow

```
Request → JwtAuthGuard → HrAddonGuard → Controller
                              │
                              ▼
              subscriptions (tenant_id)
                              │
                              ▼
              subscription_features (subscription_id)
                              │
                              ▼
              features WHERE code = 'HR_MODULE' AND is_active = 1
                              │
                    ┌─────────┴──────────┐
                   YES                   NO
                    │                    │
               continue            403 Forbidden
                                   { code: 'HR_ADDON_REQUIRED',
                                     upgradeUrl: '/billing/addons' }
```

---

## 3. Database Design

### 3.1 ไม่ต้องสร้าง Table ใหม่สำหรับ Feature Gating

ใช้โครงสร้าง `features` + `subscription_features` ที่มีอยู่แล้ว:

```
features (เพิ่ม seed record ใหม่)
├── id: UUID
├── code: 'HR_MODULE'           ← feature code สำหรับ guard check
├── name: 'HR Management Add-on'
├── type: 'module'              ← enum: toggle | limit | module
├── price_monthly: 1990.00      ← ราคา add-on ต่อเดือน (ตัวอย่าง)
└── is_active: 1

subscription_features (สร้างเมื่อ tenant ซื้อ add-on)
├── id: UUID
├── subscription_id: [tenant's subscription]
├── feature_id: [HR_MODULE feature id]
├── price: 1990.00              ← ราคาที่ tenant ซื้อจริง (อาจแตกต่างจาก list price)
├── is_active: 1
└── created_at, updated_at
```

### 3.2 Staff Schema เพิ่ม employeeId FK

```prisma
model Staff {
  id               String    @id @default(uuid())
  tenantId         String
  firstName        String
  lastName         String
  email            String
  phone            String?
  role             String
  department       String?
  employeeCode     String?
  status           String    @default("active")
  shiftType        String?
  maxTasksPerShift Int?      @default(8)
  specializations  String?   @db.Text
  rating           Decimal?  @db.Decimal(3, 2)
  efficiency       Int?      @default(100)

  // ── HR Add-on Integration ──────────────────────────────
  employeeId       String?   @unique    // null = standalone Staff
  employee         Employee? @relation("StaffEmployee",
                               fields: [employeeId],
                               references: [id],
                               onDelete: SetNull)
  // ────────────────────────────────────────────────────────

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  housekeepingTasks    HousekeepingTask[] @relation("AssignedStaff")
  inspectedTasks       HousekeepingTask[] @relation("InspectorStaff")
  maintenanceTasks     MaintenanceTask[]  @relation("AssignedTechnician")
  inspectedMaintenance MaintenanceTask[]  @relation("InspectorTechnician")

  @@index([tenantId])
  @@index([status])
  @@index([department])
  @@index([employeeId])     ← index ใหม่
  @@map("staff")
}

model Employee {
  id           String    @id @default(uuid())
  tenantId     String?
  firstName    String
  lastName     String
  email        String    @unique
  employeeCode String?   @unique
  department   String?
  position     String?
  startDate    DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // ── HR Add-on Integration ──────────────────────────────
  staff        Staff?    @relation("StaffEmployee")  ← reverse relation
  // ────────────────────────────────────────────────────────

  @@index([tenantId])
  @@map("employees")
}
```

### 3.3 Migration ที่ต้องรัน

```sql
-- 1. เพิ่ม employeeId column ใน staff
ALTER TABLE staff ADD COLUMN employeeId VARCHAR(36) NULL UNIQUE;
ALTER TABLE staff ADD INDEX idx_staff_employeeId (employeeId);
ALTER TABLE staff ADD CONSTRAINT fk_staff_employee
  FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE SET NULL;

-- 2. เพิ่ม HR_MODULE feature record
INSERT INTO features (id, code, name, description, type, price_monthly, is_active)
VALUES (UUID(), 'HR_MODULE', 'HR Management Add-on',
  'Full HR management: Employee profiles, Attendance, Leave, Payroll',
  'module', 1990.00, 1);
```

### 3.4 Index Strategy

| Index | เหตุผล |
|-------|--------|
| `staff.employeeId` | lookup staff by employee (bi-directional search) |
| `subscription_features.(subscription_id, feature_id)` | มีอยู่แล้ว — guard check fast |

---

## 4. API Design

### 4.1 Staff Endpoints (Base Package — ไม่ต้อง Add-on)

| Method | Endpoint | หน้าที่ |
|--------|----------|---------|
| GET | `/api/v1/staff` | List staff (pagination, filter by role/status/dept) |
| POST | `/api/v1/staff` | Create staff member |
| GET | `/api/v1/staff/:id` | Get staff by ID |
| PATCH | `/api/v1/staff/:id` | Update staff |
| DELETE | `/api/v1/staff/:id` | Delete staff (ถ้าไม่มี active tasks) |
| GET | `/api/v1/staff/:id/performance` | Performance metrics |

### 4.2 Staff ↔ Employee Linking (ต้อง HR Add-on)

#### POST /api/v1/staff/:id/link-employee
เชื่อม Staff กับ Employee ที่มีอยู่แล้วใน HR

**Guard:** `JwtAuthGuard` + `HrAddonGuard`

**Request:**
```json
{
  "employeeId": "uuid-of-employee",
  "syncData": true
}
```

**Business Logic:**
1. ตรวจสอบ `HrAddonGuard` — throw 403 ถ้าไม่มี add-on
2. ตรวจสอบ Staff และ Employee อยู่ใน tenantId เดียวกัน
3. ตรวจสอบ Employee ยังไม่ถูก link กับ Staff อื่น (ใช้ `@unique` บน employeeId)
4. ถ้า `syncData: true` → copy `firstName, lastName, email, phone` จาก Employee → Staff
5. Update `staff.employeeId = employeeId`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "staffId": "uuid",
    "employeeId": "uuid",
    "synced": true,
    "message": "Staff linked to employee successfully"
  }
}
```

**Errors:**
| Code | HTTP | Description |
|------|------|-------------|
| `HR_ADDON_REQUIRED` | 403 | ยังไม่ได้ซื้อ HR Add-on |
| `EMPLOYEE_NOT_FOUND` | 404 | ไม่พบ Employee |
| `EMPLOYEE_ALREADY_LINKED` | 409 | Employee นี้ถูก link กับ Staff อื่นแล้ว |
| `TENANT_MISMATCH` | 400 | Staff กับ Employee ไม่ได้อยู่ใน tenant เดียวกัน |

---

#### DELETE /api/v1/staff/:id/link-employee
ยกเลิก link ระหว่าง Staff กับ Employee

**Guard:** `JwtAuthGuard` + `HrAddonGuard`

**Response (200):**
```json
{
  "success": true,
  "data": { "message": "Staff unlinked from employee" }
}
```

---

#### GET /api/v1/staff/:id/employee
ดึงข้อมูล Employee ที่ link กับ Staff (รวม HR data: attendance, leave balance)

**Guard:** `JwtAuthGuard` + `HrAddonGuard`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "employee": {
      "id": "uuid",
      "firstName": "สมชาย",
      "lastName": "ใจดี",
      "email": "somchai@hotel.com",
      "employeeCode": "EMP001",
      "department": "housekeeping",
      "position": "Senior Housekeeper",
      "startDate": "2024-01-01"
    },
    "leaveBalance": {
      "annual": 10,
      "sick": 30,
      "personal": 3
    },
    "attendanceThisMonth": {
      "present": 18,
      "absent": 1,
      "late": 2
    }
  }
}
```

---

#### POST /api/v1/hr/employees/:id/create-staff
สร้าง Staff จาก Employee — สำหรับ HR admin โปรโมตพนักงานเป็น operational staff

**Guard:** `JwtAuthGuard` + `HrAddonGuard`

**Request:**
```json
{
  "role": "housekeeper",
  "department": "housekeeping",
  "shiftType": "morning",
  "maxTasksPerShift": 8,
  "specializations": ["deep-cleaning", "turndown"]
}
```

**Business Logic:**
1. ดึง Employee data (firstName, lastName, email, phone, employeeCode)
2. สร้าง Staff record พร้อม `employeeId = employee.id`
3. Staff ได้รับ firstName, lastName, email, phone จาก Employee
4. Operational fields (role, shiftType ฯลฯ) จาก request body

**Response (201):**
```json
{
  "success": true,
  "data": {
    "staffId": "uuid",
    "employeeId": "uuid",
    "firstName": "สมชาย",
    "role": "housekeeper",
    "message": "Staff created from employee profile"
  }
}
```

---

### 4.3 HR Endpoints (ทั้งหมดต้อง HR Add-on)

| Method | Endpoint | หน้าที่ |
|--------|----------|---------|
| GET | `/api/v1/hr/employees` | List employees |
| POST | `/api/v1/hr/employees` | Create employee |
| GET | `/api/v1/hr/employees/:id` | Get employee + linked staff |
| PATCH | `/api/v1/hr/employees/:id` | Update employee (auto-sync ไป Staff) |
| DELETE | `/api/v1/hr/employees/:id` | Delete employee (unlink Staff ก่อน) |
| GET | `/api/v1/hr/attendance` | Attendance records |
| POST | `/api/v1/hr/attendance/check-in` | Check in |
| PATCH | `/api/v1/hr/attendance/:id/check-out` | Check out |
| GET | `/api/v1/hr/leave` | Leave requests |
| POST | `/api/v1/hr/leave` | Create leave request |
| POST | `/api/v1/hr/leave/:id/approve` | Approve leave |
| POST | `/api/v1/hr/leave/:id/reject` | Reject leave |
| GET | `/api/v1/hr/payroll` | Payroll records |

### 4.4 Add-on Management Endpoint

| Method | Endpoint | หน้าที่ |
|--------|----------|---------|
| GET | `/api/v1/addons` | List available add-ons + tenant's active add-ons |
| GET | `/api/v1/addons/status` | Current tenant add-on status (สำหรับ frontend gating) |

**GET /api/v1/addons/status Response:**
```json
{
  "success": true,
  "data": {
    "activeAddons": ["HR_MODULE"],
    "availableAddons": [
      {
        "code": "HR_MODULE",
        "name": "HR Management Add-on",
        "priceMonthly": 1990,
        "isActive": true,
        "activatedAt": "2026-01-01T00:00:00Z"
      }
    ]
  }
}
```

---

## 5. Business Logic

### 5.1 Data Sync Strategy (Staff ↔ Employee)

เมื่อ Employee ถูก update → auto-sync fields บางส่วนไปยัง linked Staff

**Fields ที่ sync Employee → Staff (HR เป็น source of truth):**
| Field | sync? | เหตุผล |
|-------|-------|--------|
| firstName | ✅ | ชื่อจริงต้องตรงกัน |
| lastName | ✅ | ชื่อจริงต้องตรงกัน |
| email | ✅ | ข้อมูลการติดต่อ |
| phone | ✅ | ข้อมูลการติดต่อ |
| employeeCode | ✅ | รหัสพนักงานเดียวกัน |
| status | ❌ | Staff มี operational status ของตัวเอง (active task ฯลฯ) |

**Fields ที่ Staff จัดการเอง (ไม่ sync):**
- `role`, `department` (operations), `shiftType`, `maxTasksPerShift`
- `specializations`, `rating`, `efficiency`
- `status` (active/inactive/on_leave ของ operations)

### 5.2 Employee Deletion Logic

เมื่อ Employee ถูกลบ:
1. ถ้า Employee มี linked Staff → `staff.employeeId = null` (ON DELETE SET NULL)
2. Staff ยังคงอยู่ในระบบ operations — ไม่ถูกลบตาม
3. Log audit: "Employee [id] deleted, unlinked from Staff [id]"

### 5.3 HR Add-on Status Guard Logic

```typescript
// src/common/guards/hr-addon.guard.ts
@Injectable()
export class HrAddonGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    const hasAddon = await this.addonService.hasActiveAddon(
      user.tenantId, 'HR_MODULE'
    );
    if (!hasAddon) {
      throw new ForbiddenException({
        code: 'HR_ADDON_REQUIRED',
        message: 'HR Module Add-on is required to access this feature',
        upgradeUrl: '/billing/addons',
      });
    }
    return true;
  }
}
```

### 5.4 AddonService — ใช้ subscription_features ที่มีอยู่แล้ว

```typescript
// src/modules/addons/addon.service.ts
@Injectable()
export class AddonService {
  async hasActiveAddon(tenantId: string, featureCode: string): Promise<boolean> {
    // 1. หา active subscription ของ tenant
    const subscription = await this.prisma.subscriptions.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ['active', 'trial'] },
      },
    });
    if (!subscription) return false;

    // 2. เช็คว่า subscription_features มี feature นั้นแบบ active
    const feature = await this.prisma.subscription_features.findFirst({
      where: {
        subscription_id: subscription.id,
        is_active: 1,
        features: { code: featureCode },
      },
      include: { features: true },
    });

    return !!feature;
  }

  // สำหรับ endpoint GET /addons/status
  async getActiveAddons(tenantId: string): Promise<string[]> {
    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId, status: { in: ['active', 'trial'] } },
    });
    if (!subscription) return [];

    const features = await this.prisma.subscription_features.findMany({
      where: { subscription_id: subscription.id, is_active: 1 },
      include: { features: true },
    });

    return features
      .filter((sf) => sf.features.type === 'module')
      .map((sf) => sf.features.code);
  }
}
```

---

## 6. New Files & Changes Required

### 6.1 Backend — ไฟล์ใหม่

```
src/
├── common/
│   └── guards/
│       └── hr-addon.guard.ts           ← ใหม่
├── modules/
│   ├── addons/                         ← module ใหม่
│   │   ├── addon.module.ts
│   │   ├── addon.service.ts            ← hasActiveAddon(), getActiveAddons()
│   │   └── addon.controller.ts         ← GET /addons/status
│   ├── staff/
│   │   ├── staff.controller.ts         ← เพิ่ม link/unlink/get-employee endpoints
│   │   ├── staff.service.ts            ← เพิ่ม linkEmployee(), unlinkEmployee(), getLinkedEmployee()
│   │   └── dto/
│   │       └── link-employee.dto.ts    ← ใหม่: { employeeId, syncData }
│   └── hr/
│       ├── hr.controller.ts            ← เพิ่ม create-staff endpoint + HrAddonGuard ทุก route
│       └── hr.service.ts               ← เพิ่ม createStaffFromEmployee(), syncToStaff()
```

### 6.2 Backend — ไฟล์ที่แก้ไข

```
prisma/schema.prisma                    ← เพิ่ม employeeId FK ใน Staff + reverse relation ใน Employee
src/app.module.ts                       ← import AddonModule
```

### 6.3 Frontend — ไฟล์ใหม่

```
lib/
├── hooks/
│   └── useAddonStatus.ts               ← React hook: { hasHrAddon, activeAddons, isLoading }
├── stores/
│   └── addonStore.ts                   ← Zustand store: addon status + cache
components/
├── staff/
│   └── LinkEmployeeModal.tsx           ← Modal เลือก Employee เพื่อ link กับ Staff
└── common/
    └── AddonGate.tsx                   ← Wrapper component: แสดง upgrade CTA ถ้าไม่มี add-on
```

### 6.4 Frontend — ไฟล์ที่แก้ไข

```
lib/api/client.ts                       ← เพิ่ม addons endpoints, staff link/unlink endpoints
components/housekeeping/
└── StaffAssignmentPanel.tsx            ← เพิ่ม "View HR Profile" button (ถ้ามี HR add-on)
app/dashboard/
└── hr/                                 ← ทุกหน้า wrap ด้วย <AddonGate addon="HR_MODULE">
```

---

## 7. Frontend Feature Gating Pattern

### 7.1 AddonGate Component

```tsx
// components/common/AddonGate.tsx
interface AddonGateProps {
  addon: 'HR_MODULE' | 'CRM_MODULE' | string;
  children: React.ReactNode;
  fallback?: React.ReactNode;  // ถ้าไม่ระบุ จะแสดง default upgrade card
}

function AddonGate({ addon, children, fallback }: AddonGateProps) {
  const { hasAddon } = useAddonStatus(addon);
  if (hasAddon) return <>{children}</>;
  return fallback ?? <UpgradeAddonCard addon={addon} />;
}

// ตัวอย่างการใช้งาน
<AddonGate addon="HR_MODULE">
  <HrDashboard />   {/* แสดงเฉพาะเมื่อมี add-on */}
</AddonGate>
```

### 7.2 UpgradeAddonCard — แสดงเมื่อไม่มี add-on

```
┌─────────────────────────────────────────┐
│  🔒  ฟีเจอร์นี้ต้องการ HR Add-on          │
│                                          │
│  จัดการพนักงานแบบครบวงจร               │
│  • ประวัติพนักงาน                        │
│  • บันทึกเวลาเข้า-ออก                   │
│  • ระบบลา                               │
│  • เชื่อมข้อมูลกับแม่บ้าน/ช่างซ่อม     │
│                                          │
│  ฿1,990 / เดือน                         │
│  [  อัปเกรด HR Add-on  ]                │
└─────────────────────────────────────────┘
```

### 7.3 Staff Form — Link Employee Section (แสดงเฉพาะเมื่อมี HR Add-on)

```
Staff Information
─────────────────────────────────────
ชื่อ: [          ]  นามสกุล: [          ]
บทบาท: [Housekeeper ▼]  กะ: [เช้า ▼]

──── HR Integration ──────────────────  ← แสดงเฉพาะ HR Add-on active
เชื่อมกับระบบ HR:
  ● ยังไม่ได้เชื่อม  [ เลือกพนักงาน HR ]
  ○ เชื่อมกับ EMP001 - สมชาย ใจดี   [ ยกเลิกการเชื่อม ]
─────────────────────────────────────
```

---

## 8. Security Considerations

| ประเด็น | การจัดการ |
|---------|----------|
| Tenant isolation | ทุก HR/Staff endpoint ตรวจสอบ `tenantId` จาก JWT |
| Add-on bypass | Guard check ที่ backend เสมอ — ไม่เชื่อ frontend |
| Employee data privacy | Employee ที่มี linked Staff จะแสดงข้อมูลเฉพาะที่จำเป็น |
| Audit logging | Link/Unlink actions ถูก log ใน AuditLog |
| Cache invalidation | AddonStatus cache invalidate เมื่อ subscription เปลี่ยน |

---

## 9. Performance Considerations

### 9.1 Add-on Status Caching

Guard ทำงานทุก request — ต้อง cache เพื่อไม่ให้ query DB ทุกครั้ง:

```typescript
// ใช้ Redis cache 5 นาที
@Injectable()
export class AddonService {
  async hasActiveAddon(tenantId: string, featureCode: string): Promise<boolean> {
    const cacheKey = `addon:${tenantId}:${featureCode}`;

    // Check Redis cache ก่อน
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    // Query DB
    const result = await this.queryDatabase(tenantId, featureCode);

    // Cache 5 นาที
    await this.cacheManager.set(cacheKey, result, 300);
    return result;
  }

  // เรียกตอน subscription update
  async invalidateAddonCache(tenantId: string): Promise<void> {
    const keys = await this.cacheManager.store.keys(`addon:${tenantId}:*`);
    await Promise.all(keys.map((k) => this.cacheManager.del(k)));
  }
}
```

### 9.2 Staff + Employee Join Query

เมื่อ list staff พร้อม HR data (กรณีมี add-on):
```typescript
// ใช้ Prisma include แทน N+1 query
await this.prisma.staff.findMany({
  include: {
    employee: {    // ← join ครั้งเดียว
      select: { firstName: true, lastName: true, email: true,
                position: true, department: true }
    }
  }
});
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Test | ไฟล์ | Coverage |
|------|------|---------|
| `AddonService.hasActiveAddon()` — tenant มี add-on | `addon.service.spec.ts` | ✅ |
| `AddonService.hasActiveAddon()` — tenant ไม่มี add-on | `addon.service.spec.ts` | ✅ |
| `HrAddonGuard.canActivate()` — pass | `hr-addon.guard.spec.ts` | ✅ |
| `HrAddonGuard.canActivate()` — throw 403 | `hr-addon.guard.spec.ts` | ✅ |
| `StaffService.linkEmployee()` — success | `staff.service.spec.ts` | ✅ |
| `StaffService.linkEmployee()` — employee already linked | `staff.service.spec.ts` | ✅ |
| `StaffService.linkEmployee()` — tenant mismatch | `staff.service.spec.ts` | ✅ |

### 10.2 Integration Tests

| Scenario | ผลที่คาดหวัง |
|----------|-------------|
| GET /hr/employees ไม่มี HR add-on | 403 + `HR_ADDON_REQUIRED` |
| GET /hr/employees มี HR add-on | 200 + list |
| POST /staff/:id/link-employee valid | 200 + Staff.employeeId updated |
| GET /staff มี add-on | staff list มี `employee` field |
| GET /staff ไม่มี add-on | staff list ปกติ ไม่มี `employee` field |
| DELETE employee ที่มี linked staff | staff.employeeId = null, staff ยังอยู่ |

---

## 11. Deployment Plan

### Phase 1 — Schema + AddonService (ไม่กระทบ production)
1. รัน Prisma migration เพิ่ม `employeeId` column (nullable — ไม่กระทบ data เดิม)
2. Seed `HR_MODULE` feature record ใน `features` table
3. Deploy `AddonService` + `AddonModule`
4. Deploy `HrAddonGuard` (ยังไม่ใช้)

### Phase 2 — Apply Guard ไปยัง HR endpoints
1. เพิ่ม `@UseGuards(HrAddonGuard)` ใน `HrController`
2. Activate สำหรับ tenant ที่ซื้อ HR Add-on ผ่าน admin panel
3. ทดสอบกับ tenant ที่มี / ไม่มี add-on

### Phase 3 — Staff ↔ Employee Integration
1. เพิ่ม link/unlink endpoints ใน `StaffController`
2. เพิ่ม `POST /hr/employees/:id/create-staff`
3. Deploy frontend `LinkEmployeeModal` + `AddonGate`

### Phase 4 — Auto-sync
1. เพิ่ม auto-sync Employee → Staff เมื่อ Employee update
2. Audit logging

---

## 12. Open Questions

| # | คำถาม | เจ้าของ | สถานะ |
|---|------|--------|------|
| 1 | ราคา HR Add-on กี่บาท/เดือน? | Product | Pending |
| 2 | HR Add-on รวมอยู่ใน plan ไหนแล้ว (ถ้ามี)? | Product | Pending |
| 3 | Trial HR Add-on กี่วัน? | Product | Pending |
| 4 | ถ้าหยุดจ่าย HR Add-on → ข้อมูล Employee หายไหม หรือแค่ access ไม่ได้? | Product | Pending |
| 5 | Staff ที่ link กับ Employee อยู่ → ถ้า cancel add-on link หายไหม? | Tech | Pending |

> **แนะนำ Q4-5:** ข้อมูล Employee ยังอยู่ แค่ access ไม่ได้ (soft lock) และ link ยังคงอยู่ใน DB แต่ Guard บล็อก — เมื่อต่ออายุ add-on ทุกอย่างกลับมาปกติ

---

## 13. Summary — สิ่งที่ต้องทำ

```
Backend (Priority Order):
────────────────────────────────────────────────────────
[ ] 1. Prisma migration: เพิ่ม employeeId FK ใน staff table
[ ] 2. Seed: เพิ่ม HR_MODULE ใน features table
[ ] 3. สร้าง AddonModule + AddonService (hasActiveAddon, getActiveAddons)
[ ] 4. สร้าง HrAddonGuard
[ ] 5. Apply HrAddonGuard ไปทุก route ใน HrController
[ ] 6. เพิ่ม link/unlink/get-employee endpoints ใน StaffController
[ ] 7. เพิ่ม create-staff endpoint ใน HrController
[ ] 8. HrService: เพิ่ม auto-sync Employee → Staff เมื่อ update
[ ] 9. Redis cache ใน AddonService
[ ] 10. Unit + Integration tests

Frontend (Priority Order):
────────────────────────────────────────────────────────
[ ] 1. สร้าง addonStore.ts + useAddonStatus hook
[ ] 2. เพิ่ม GET /addons/status ใน api/client.ts
[ ] 3. สร้าง AddonGate.tsx + UpgradeAddonCard component
[ ] 4. สร้าง LinkEmployeeModal.tsx
[ ] 5. Wrap HR pages ด้วย <AddonGate addon="HR_MODULE">
[ ] 6. เพิ่ม HR Integration section ใน Staff form
[ ] 7. เพิ่ม "View HR Profile" ใน StaffAssignmentPanel
```
