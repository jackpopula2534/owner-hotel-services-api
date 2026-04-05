# StaySync — Backend Development Tracker
> อัปเดตล่าสุด: 2026-04-05 (commit pending)

## ภาพรวม

ระบบจัดการโรงแรม SaaS (StaySync) — Backend API ใช้ NestJS 10 + TypeScript + Prisma ORM (MySQL)

Feature หลักที่กำลังพัฒนา:
- ระบบ Check-in/Check-out แบบ Time-aware (เก็บเวลาจริง ไม่ใช่แค่วันที่)
- Housekeeping & Maintenance ผ่าน API จริง (แทน mock data)
- Room Availability คำนวณจาก cleaning buffer
- Staff Management Module ใหม่
- Maintenance Module ใหม่

---

## Phase 1 — Prisma Schema

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 1.1 | Property: เพิ่ม standardCheckInTime, standardCheckOutTime, cleaningBufferMinutes, early/late checkout settings, timezone | ✅ Done | 2026-04-05 |
| 1.2 | Booking: เพิ่ม scheduledCheckIn, scheduledCheckOut, requestedEarlyCheckIn, approvedEarlyCheckIn, earlyCheckInFee, requestedLateCheckOut, approvedLateCheckOut, lateCheckOutFee | ✅ Done | 2026-04-05 |
| 1.3 | Staff model ใหม่ (id, tenantId, firstName, lastName, role, department, shiftType, status, specializations, rating, efficiency) | ✅ Done | 2026-04-05 |
| 1.4 | MaintenanceTask model ใหม่ (title, category, priority, status, scheduling, cost tracking, quality assurance) | ✅ Done | 2026-04-05 |
| 1.5 | HousekeepingTask: เพิ่ม bookingId, scheduledFor, roomReadyAt, actualStartTime, actualEndTime, actualDuration, inspectedById relation | ✅ Done | 2026-04-05 |
| 1.6 | BookingAddOn model ใหม่ (early_checkin, late_checkout, extra_bed fees) | ✅ Done | 2026-04-05 |
| 1.7 | Room: เพิ่ม relation maintenanceTasks | ✅ Done | 2026-04-05 |
| 1.8 | Prisma migration รัน + TypeScript compile check | ✅ Done | 2026-04-05 |

---

## Phase 2 — Business Logic (Services)

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 2.1 | RoomAvailabilityService: คำนวณ availability แบบ time-aware (รวม cleaning buffer) | ✅ Done | 2026-04-05 |
| 2.2 | BookingsService.create(): แปลง date-only → scheduledCheckIn/Out ตาม Property time settings | ✅ Done | 2026-04-05 |
| 2.3 | BookingsService.checkOut(): คำนวณ roomReadyAt = actualCheckOut + cleaningBufferMinutes | ✅ Done | 2026-04-05 |
| 2.4 | HousekeepingService.completeTask(): update roomReadyAt + room.status = available | ✅ Done | 2026-04-05 |
| 2.5 | PropertyTimeSettingsService: CRUD settings ต่อ property | ✅ Done | 2026-04-05 |

---

## Phase 3 — Backend API Endpoints

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 3.1 | HousekeepingController (สร้างใหม่ — ตอนนี้ไม่มี) | ✅ Done | 2026-04-05 |
| 3.2 | HousekeepingService: CRUD tasks + assign + start + complete + inspect | ✅ Done | 2026-04-05 |
| 3.3 | StaffController + StaffService (module ใหม่) | ✅ Done | 2026-04-05 |
| 3.4 | MaintenanceController + MaintenanceService (module ใหม่) | ✅ Done | 2026-04-05 |
| 3.5 | RoomsController: GET /rooms/available เพิ่ม datetime-aware check | ✅ Done | 2026-04-05 |
| 3.6 | PropertiesController: GET/PUT /properties/:id/time-settings | ✅ Done | 2026-04-05 |
| 3.7 | BookingsController: POST /bookings/:id/request-early-checkin, request-late-checkout, approve-early-checkin, approve-late-checkout | ✅ Done | 2026-04-05 |
| 3.8 | เพิ่ม Swagger docs ทุก endpoint ใหม่ | ✅ Done | 2026-04-05 |

---

## Phase 4 — Frontend Integration (Backend side)

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 4.1 | ลงทะเบียน StaffModule ใน AppModule | ✅ Done | 2026-04-05 |
| 4.2 | ลงทะเบียน MaintenanceModule ใน AppModule | ✅ Done | 2026-04-05 |
| 4.3 | ลงทะเบียน HousekeepingController (ที่ขาดอยู่) | ✅ Done | 2026-04-05 |

---

## Phase 5 — Testing

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 5.1 | Unit tests: RoomAvailabilityService | ✅ Done | 2026-04-05 |
| 5.2 | Unit tests: BookingsService time-aware logic | ✅ Done | 2026-04-05 |
| 5.3 | Unit tests: StaffService | ✅ Done | 2026-04-05 |
| 5.4 | Unit tests: MaintenanceService | ✅ Done | 2026-04-05 |
| 5.5 | Integration tests: Booking → Checkout → Housekeeping flow | ✅ Done | 2026-04-05 |

---

## Phase 6 — Performance & Security

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 6.1 | Index optimization สำหรับ scheduledCheckIn/scheduledCheckOut | ✅ Done (ใน schema) | 2026-04-05 |
| 6.2 | Rate limiting บน housekeeping/maintenance endpoints | ✅ Done | 2026-04-05 |
| 6.3 | Audit log สำหรับ housekeeping task completion | ✅ Done | 2026-04-05 |

---

## Phase 7 — Documentation

| # | รายการ | สถานะ | วันที่แล้วเสร็จ |
|---|--------|--------|----------------|
| 7.1 | Swagger docs ครบทุก endpoint | ✅ Done | 2026-04-05 |
| 7.2 | CLAUDE.md อัปเดต tech stack ใหม่ | ✅ Done | 2026-04-05 |

---

## Modules ที่สร้างใหม่

```
src/modules/
├── staff/
│   ├── staff.module.ts
│   ├── staff.controller.ts
│   ├── staff.service.ts
│   └── dto/
│       ├── create-staff.dto.ts
│       └── update-staff.dto.ts
├── maintenance/
│   ├── maintenance.module.ts
│   ├── maintenance.controller.ts
│   ├── maintenance.service.ts
│   └── dto/
│       ├── create-maintenance-task.dto.ts
│       └── update-maintenance-task.dto.ts
└── housekeeping/                    ← เพิ่ม controller (เดิมมีแค่ service)
    ├── housekeeping.controller.ts   ← สร้างใหม่
    └── dto/
        └── update-housekeeping-task.dto.ts  ← สร้างใหม่
```

## New Prisma Models

| Model | ตาราง DB | หมายเหตุ |
|-------|----------|---------|
| `Staff` | `staff` | แทน hardcoded mock data |
| `MaintenanceTask` | `maintenance_tasks` | ยังไม่มีใน schema เดิม |
| `BookingAddOn` | `booking_add_ons` | track fees พิเศษ |

## Schema Fields เพิ่มเข้ามา

| Model | Fields ใหม่ |
|-------|------------|
| `Property` | standardCheckInTime, standardCheckOutTime, cleaningBufferMinutes, earlyCheckInEnabled, lateCheckOutEnabled, earlyCheckInFeeType, earlyCheckInFeeAmount, lateCheckOutFeeType, lateCheckOutFeeAmount, timezone |
| `Booking` | scheduledCheckIn, scheduledCheckOut, requestedEarlyCheckIn, approvedEarlyCheckIn, earlyCheckInFee, requestedLateCheckOut, approvedLateCheckOut, lateCheckOutFee |
| `HousekeepingTask` | bookingId, scheduledFor, roomReadyAt, actualStartTime, actualEndTime, actualDuration, inspectedById |
| `Room` | maintenanceTasks (relation) |

---

## Modules / Files เพิ่มเติม (Phase 2.5, 3.6, 3.7)

```
src/modules/properties/
├── property-time-settings.service.ts   ← ใหม่ (Phase 2.5)
└── dto/
    └── update-time-settings.dto.ts     ← ใหม่ (Phase 3.6)

src/modules/bookings/dto/
├── request-early-checkin.dto.ts        ← ใหม่ (Phase 3.7)
└── request-late-checkout.dto.ts        ← ใหม่ (Phase 3.7)
```

## New API Endpoints (Phase 3.6, 3.7)

| Method | Endpoint | หน้าที่ |
|--------|----------|--------|
| GET | `/api/v1/properties/:id/time-settings` | ดึง time settings ของ property |
| PUT | `/api/v1/properties/:id/time-settings` | อัปเดต time settings |
| POST | `/api/v1/bookings/:id/request-early-checkin` | Guest/staff ขอ early check-in |
| POST | `/api/v1/bookings/:id/approve-early-checkin` | Manager อนุมัติ early check-in |
| POST | `/api/v1/bookings/:id/request-late-checkout` | Guest/staff ขอ late check-out |
| POST | `/api/v1/bookings/:id/approve-late-checkout` | Manager อนุมัติ late check-out |

## Commit History

| Hash | Message | วันที่ |
|------|---------|-------|
| pending | feat: add PropertyTimeSettingsService + early/late check-in/out endpoints | 2026-04-05 |
| 48b2e2e | fix: resolve booking display and double-booking bugs | 2026-04-05 |
| 7aabb04 | feat: add time-aware booking + housekeeping/maintenance/staff modules | 2026-04-05 |
