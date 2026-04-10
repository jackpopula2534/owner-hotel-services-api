# Booking Activity Tracking — Design Document

## สรุปภาพรวม

เพิ่มระบบ Activity Tracking ในหน้า Booking Detail เพื่อแสดง **timeline ของทุก action** ที่เกิดขึ้นกับ booking นั้น ตั้งแต่สร้างจนจบ — ใครทำอะไร เมื่อไหร่ มีรายละเอียดอะไรบ้าง

---

## 1. สถานะปัจจุบัน (Current State Analysis)

### ✅ สิ่งที่มีอยู่แล้ว

| Component | สถานะ | หมายเหตุ |
|-----------|--------|----------|
| **AuditLog Model** (Prisma) | ✅ พร้อมใช้ | มี fields ครบ: action, resource, resourceId, userId, oldValues, newValues, description, createdAt |
| **AuditLogService** | ✅ พร้อมใช้ | มี `log()`, `getLogs()`, `logBookingCreate()`, `logBookingCancel()` |
| **AuditLog API** | ✅ มี endpoint | `GET /api/v1/audit-logs?resource=booking&resourceId={id}` |
| **AuditAction Enum** | ✅ ครบ | มี BOOKING_CREATE, BOOKING_UPDATE, BOOKING_CANCEL, BOOKING_CHECKIN, BOOKING_CHECKOUT |
| **BookingTimeline Component** | ✅ มีอยู่ | แสดง lifecycle แบบ static (ไม่ใช้ข้อมูลจาก audit log จริง) |

### ❌ Gap ที่ต้องแก้ไข

| Gap | รายละเอียด | ความสำคัญ |
|-----|-----------|-----------|
| **Booking Update ไม่ log** | `update()` / `PATCH` ไม่ได้เรียก auditLogService | 🔴 Critical |
| **Booking Cancel ไม่ log** | `remove()` method ไม่ได้ log (มี method แต่ไม่ได้เรียก) | 🔴 Critical |
| **Booking Confirm ไม่ log** | confirm ผ่าน `update(status: confirmed)` ไม่มี log แยก | 🟡 High |
| **Early Check-in Request/Approve ไม่ log** | ไม่มี audit action เฉพาะ | 🟡 High |
| **Late Check-out Request/Approve ไม่ log** | ไม่มี audit action เฉพาะ | 🟡 High |
| **Folio Charges ไม่ log** | การเพิ่ม charge / finalize ไม่ถูก track | 🟡 High |
| **Payment ไม่ log กับ Booking** | payment สร้างแล้วแต่ไม่ผูกกับ booking audit | 🟢 Medium |
| **userId ใช้ 'system'** | `logBookingCreate()` ส่ง `'system'` แทน actual user | 🟡 High |
| **ไม่มี dedicated endpoint** | ต้องใช้ general audit-log API ที่ต้อง admin role | 🔴 Critical |
| **Frontend ไม่แสดง audit data** | BookingTimeline ใช้ข้อมูล static จาก booking object | 🔴 Critical |

---

## 2. การออกแบบ — Backend

### 2.1 เพิ่ม AuditAction ใหม่

**ไฟล์:** `src/audit-log/dto/audit-log.dto.ts`

```typescript
// เพิ่มใน AuditAction enum
BOOKING_CONFIRM = 'booking_confirm',
BOOKING_EARLY_CHECKIN_REQUEST = 'booking_early_checkin_request',
BOOKING_EARLY_CHECKIN_APPROVE = 'booking_early_checkin_approve',
BOOKING_LATE_CHECKOUT_REQUEST = 'booking_late_checkout_request',
BOOKING_LATE_CHECKOUT_APPROVE = 'booking_late_checkout_approve',
BOOKING_FOLIO_CHARGE = 'booking_folio_charge',
BOOKING_FOLIO_FINALIZE = 'booking_folio_finalize',
BOOKING_PAYMENT = 'booking_payment',
BOOKING_NOTE_UPDATE = 'booking_note_update',
```

### 2.2 เพิ่ม Audit Logging ใน BookingsService

**ไฟล์:** `src/modules/bookings/bookings.service.ts`

ต้องเพิ่ม audit log ในทุก method ที่เปลี่ยนสถานะ booking:

```typescript
// === 1. create() — แก้ userId จาก 'system' เป็น actual user ===
// ปัจจุบัน: this.auditLogService.logBookingCreate(booking, 'system', undefined)
// แก้เป็น: this.auditLogService.logBookingCreate(booking, userId, ipAddress)
// → ต้องรับ userId จาก controller (จาก @Req() request)

// === 2. update() — เพิ่ม audit log ===
async update(id: string, updateBookingDto, userId?: string) {
  const oldBooking = await this.prisma.booking.findUnique({ where: { id } });
  // ... existing update logic ...
  const updatedBooking = await this.prisma.booking.update({ ... });
  
  // ตรวจว่าเป็น confirm หรือ general update
  const isConfirm = oldBooking.status === 'pending' && updatedBooking.status === 'confirmed';
  
  this.auditLogService.log({
    action: isConfirm ? AuditAction.BOOKING_CONFIRM : AuditAction.BOOKING_UPDATE,
    resource: AuditResource.BOOKING,
    resourceId: id,
    oldValues: { status: oldBooking.status, ...changedFields(oldBooking) },
    newValues: { status: updatedBooking.status, ...changedFields(updatedBooking) },
    userId,
    tenantId: oldBooking.tenantId,
    description: isConfirm 
      ? `Booking confirmed for ${updatedBooking.guestFirstName} ${updatedBooking.guestLastName}`
      : `Booking updated: ${describeChanges(oldBooking, updatedBooking)}`,
  }).catch(() => {}); // non-blocking
}

// === 3. remove() — เพิ่ม audit log ===
async remove(id: string, userId?: string) {
  const booking = await this.prisma.booking.findUnique({ where: { id } });
  // ... existing cancel logic ...
  
  this.auditLogService.logBookingCancel(booking, userId || 'system');
}

// === 4. requestEarlyCheckIn() — เพิ่ม audit log ===
// === 5. approveEarlyCheckIn() — เพิ่ม audit log ===
// === 6. requestLateCheckOut() — เพิ่ม audit log ===
// === 7. approveLateCheckOut() — เพิ่ม audit log ===
// === 8. addFolioCharge() — เพิ่ม audit log ===
// === 9. finalizeFolio() — เพิ่ม audit log ===
```

### 2.3 เพิ่ม Booking Activity API Endpoint

**ไฟล์ใหม่ไม่จำเป็น** — เพิ่มใน `bookings.controller.ts`

```
GET /bookings/:id/activities?page=1&limit=20
```

Endpoint นี้ต่างจาก audit-log API ทั่วไปตรงที่:
- ไม่ต้อง admin role — แค่ authenticated user ที่เข้าถึง booking นี้ได้
- Filter เฉพาะ `resource=booking AND resourceId={bookingId}`
- รวม related activities ด้วย (housekeeping task ที่เกิดจาก booking นี้, payment ที่ผูกกับ booking นี้)
- Return format ที่ frontend ใช้แสดง timeline ได้ทันที

**Response Format:**

```json
{
  "success": true,
  "data": {
    "activities": [
      {
        "id": "uuid",
        "action": "booking_create",
        "actionLabel": "สร้างการจอง",
        "description": "สร้างการจองสำหรับ จิราพร ศรีสวัสดิ์ ห้อง 452",
        "performedBy": {
          "id": "user-uuid",
          "name": "premium.test",
          "role": "owner"
        },
        "timestamp": "2026-04-09T10:30:00.000Z",
        "changes": {
          "status": { "from": null, "to": "pending" },
          "roomId": { "from": null, "to": "room-452" },
          "totalPrice": { "from": null, "to": 1921 }
        },
        "category": "booking",
        "icon": "plus-circle",
        "color": "blue"
      },
      {
        "id": "uuid",
        "action": "booking_confirm",
        "actionLabel": "ยืนยันการจอง",
        "description": "ยืนยันการจองเรียบร้อย",
        "performedBy": {
          "id": "user-uuid",
          "name": "premium.test",
          "role": "owner"
        },
        "timestamp": "2026-04-09T10:35:00.000Z",
        "changes": {
          "status": { "from": "pending", "to": "confirmed" }
        },
        "category": "booking",
        "icon": "check-circle",
        "color": "green"
      },
      {
        "id": "uuid",
        "action": "booking_checkin",
        "actionLabel": "เช็คอิน",
        "description": "แขกเช็คอินเข้าห้อง 452",
        "performedBy": {
          "id": "user-uuid",
          "name": "receptionist01",
          "role": "staff"
        },
        "timestamp": "2026-04-09T13:22:00.000Z",
        "changes": {
          "status": { "from": "confirmed", "to": "checked_in" },
          "actualCheckIn": { "from": null, "to": "2026-04-09T13:22:00.000Z" }
        },
        "category": "booking",
        "icon": "log-in",
        "color": "indigo"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

### 2.4 BookingsService — เพิ่ม method `getBookingActivities()`

```typescript
async getBookingActivities(bookingId: string, tenantId: string, page = 1, limit = 20) {
  // 1. ดึง audit logs ที่เกี่ยวกับ booking นี้
  const bookingLogs = await this.prisma.auditLog.findMany({
    where: {
      resource: 'booking',
      resourceId: bookingId,
      tenantId,
    },
    orderBy: { createdAt: 'asc' }, // เรียงจากเก่าไปใหม่ (timeline)
    skip: (page - 1) * limit,
    take: limit,
  });

  // 2. ดึง related activities (housekeeping, payment) ถ้ามี
  const booking = await this.prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true },
  });

  const relatedLogs = await this.prisma.auditLog.findMany({
    where: {
      tenantId,
      OR: [
        { resource: 'payment', description: { contains: bookingId } },
        { resource: 'housekeeping_task', description: { contains: bookingId } },
        { resource: 'room', description: { contains: bookingId } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  // 3. Merge + sort + enrich with user info
  const allLogs = [...bookingLogs, ...relatedLogs]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // 4. Enrich with user names
  const userIds = [...new Set(allLogs.map(l => l.userId).filter(Boolean))];
  const users = userIds.length > 0
    ? await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const userMap = new Map(users.map(u => [u.id, u]));

  // 5. Transform to activity format
  return {
    activities: allLogs.map(log => this.mapToActivity(log, userMap)),
    total: allLogs.length,
    page,
    limit,
  };
}

private mapToActivity(log: any, userMap: Map<string, any>) {
  const user = log.userId ? userMap.get(log.userId) : null;
  return {
    id: log.id,
    action: log.action,
    actionLabel: this.getActionLabel(log.action),
    description: log.description,
    performedBy: user
      ? { id: user.id, name: user.name || user.email, role: user.role }
      : { id: 'system', name: 'ระบบ', role: 'system' },
    timestamp: log.createdAt,
    changes: this.buildChanges(log.oldValues, log.newValues),
    category: log.resource,
    icon: this.getActionIcon(log.action),
    color: this.getActionColor(log.action),
  };
}

private getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    booking_create: 'สร้างการจอง',
    booking_confirm: 'ยืนยันการจอง',
    booking_update: 'แก้ไขการจอง',
    booking_cancel: 'ยกเลิกการจอง',
    booking_checkin: 'เช็คอิน',
    booking_checkout: 'เช็คเอาท์',
    booking_early_checkin_request: 'ขอ Early Check-in',
    booking_early_checkin_approve: 'อนุมัติ Early Check-in',
    booking_late_checkout_request: 'ขอ Late Check-out',
    booking_late_checkout_approve: 'อนุมัติ Late Check-out',
    booking_folio_charge: 'เพิ่มค่าใช้จ่าย',
    booking_folio_finalize: 'ปิดยอดใบเสร็จ',
    booking_payment: 'ชำระเงิน',
    booking_note_update: 'อัปเดตหมายเหตุ',
    payment_create: 'สร้างรายการชำระเงิน',
    payment_approve: 'อนุมัติการชำระเงิน',
    housekeeping_task_complete: 'แม่บ้านทำความสะอาดเสร็จ',
    room_status_change: 'เปลี่ยนสถานะห้อง',
  };
  return labels[action] || action;
}

private getActionIcon(action: string): string {
  const icons: Record<string, string> = {
    booking_create: 'plus-circle',
    booking_confirm: 'check-circle',
    booking_update: 'edit',
    booking_cancel: 'x-circle',
    booking_checkin: 'log-in',
    booking_checkout: 'log-out',
    booking_early_checkin_request: 'clock',
    booking_early_checkin_approve: 'check-square',
    booking_late_checkout_request: 'clock',
    booking_late_checkout_approve: 'check-square',
    booking_folio_charge: 'receipt',
    booking_folio_finalize: 'file-check',
    booking_payment: 'credit-card',
    booking_note_update: 'message-square',
    payment_create: 'credit-card',
    payment_approve: 'check',
    housekeeping_task_complete: 'sparkles',
    room_status_change: 'door-open',
  };
  return icons[action] || 'activity';
}

private getActionColor(action: string): string {
  const colors: Record<string, string> = {
    booking_create: 'blue',
    booking_confirm: 'green',
    booking_update: 'amber',
    booking_cancel: 'red',
    booking_checkin: 'indigo',
    booking_checkout: 'gray',
    booking_early_checkin_request: 'amber',
    booking_early_checkin_approve: 'green',
    booking_late_checkout_request: 'amber',
    booking_late_checkout_approve: 'green',
    booking_folio_charge: 'purple',
    booking_folio_finalize: 'teal',
    booking_payment: 'emerald',
    booking_note_update: 'slate',
    payment_create: 'emerald',
    payment_approve: 'green',
    housekeeping_task_complete: 'teal',
    room_status_change: 'cyan',
  };
  return colors[action] || 'gray';
}
```

### 2.5 Controller Endpoint

**ไฟล์:** `src/modules/bookings/bookings.controller.ts`

```typescript
@Get(':id/activities')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: 'Get booking activity timeline' })
@ApiResponse({ status: 200, description: 'Activity timeline for this booking' })
async getBookingActivities(
  @Param('id') id: string,
  @Query('page') page?: number,
  @Query('limit') limit?: number,
  @Req() req?: any,
) {
  const tenantId = req?.user?.tenantId;
  const activities = await this.bookingsService.getBookingActivities(
    id,
    tenantId,
    page || 1,
    limit || 50,
  );
  return { success: true, data: activities };
}
```

---

## 3. การออกแบบ — Frontend

### 3.1 Component: `BookingActivityTimeline`

**ไฟล์ใหม่:** `components/bookings/BookingActivityTimeline.tsx`

**UI Design ตาม StaySync Design System:**

```
┌─────────────────────────────────────────────────────────┐
│  📋 ประวัติกิจกรรม (Activity Log)                        │
│                                                         │
│  ●── 9 เม.ย. 2569 เวลา 10:30                           │
│  │   สร้างการจอง                                        │
│  │   สร้างการจองสำหรับ จิราพร ศรีสวัสดิ์ ห้อง 452        │
│  │   โดย: premium.test (เจ้าของโรงแรม)                   │
│  │   ┌─────────────────────────────────────┐             │
│  │   │ สถานะ: — → รอยืนยัน                │             │
│  │   │ ห้อง: 452 (standard)               │             │
│  │   │ ราคารวม: ฿1,921                    │             │
│  │   └─────────────────────────────────────┘             │
│  │                                                      │
│  ●── 9 เม.ย. 2569 เวลา 10:35                           │
│  │   ✅ ยืนยันการจอง                                     │
│  │   ยืนยันการจองเรียบร้อย                               │
│  │   โดย: premium.test (เจ้าของโรงแรม)                   │
│  │   ┌─────────────────────────────────────┐             │
│  │   │ สถานะ: รอยืนยัน → ยืนยันแล้ว       │             │
│  │   └─────────────────────────────────────┘             │
│  │                                                      │
│  ●── 9 เม.ย. 2569 เวลา 13:22                           │
│  │   🔑 เช็คอิน                                          │
│  │   แขกเช็คอินเข้าห้อง 452                              │
│  │   โดย: receptionist01 (พนักงานต้อนรับ)                │
│  │   ┌─────────────────────────────────────┐             │
│  │   │ สถานะ: ยืนยันแล้ว → เข้าพักแล้ว     │             │
│  │   │ เช็คอินจริง: 9 เม.ย. 2569 13:22    │             │
│  │   └─────────────────────────────────────┘             │
│  │                                                      │
│  ●── 10 เม.ย. 2569 เวลา 11:45                          │
│  │   🧹 แม่บ้านทำความสะอาดเสร็จ                          │
│  │   ห้อง 452 พร้อมรับแขกใหม่                            │
│  │   โดย: housekeeper03 (แม่บ้าน)                       │
│  │                                                      │
│  ○── 10 เม.ย. 2569 เวลา 12:00 (กำหนด)                  │
│      🚪 เช็คเอาท์                                        │
│      รอเช็คเอาท์                                         │
│                                                         │
│  ─── แสดงเพิ่มเติม (2 รายการ) ───                        │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Design Decisions (UX)

| Decision | เหตุผล |
|----------|--------|
| **เรียงจากเก่า → ใหม่ (top-down)** | อ่าน narrative ได้ต่อเนื่องเหมือนเรื่องราว |
| **แสดง changes แบบ collapsible** | ไม่รกเกินไป แต่กดดูรายละเอียดได้ |
| **แสดงชื่อผู้ทำ + role** | Manager เห็นว่าใครทำ — accountability |
| **ใช้ icon + สีตาม action type** | เห็นปุ๊บรู้ทันที ไม่ต้องอ่าน (Speed over beauty) |
| **วาง section ใน main content** | ไม่ใช่ sidebar — ข้อมูลสำคัญต้องเห็นชัด |
| **เปิด-ปิดได้ (collapsible section)** | เริ่มเปิดอยู่ แต่ user ปิดได้ถ้าไม่ต้องการ |
| **Lazy load** | โหลดเฉพาะเมื่อ section visible (intersection observer) |

### 3.3 วางตำแหน่งในหน้า Booking Detail

```
┌──────────────────────────────┐  ┌──────────────────┐
│  ข้อมูลการจอง                │  │  การดำเนินการ     │
├──────────────────────────────┤  ├──────────────────┤
│  รายละเอียดราคารายคืน        │  │  ห้องที่จอง       │
├──────────────────────────────┤  └──────────────────┘
│  ข้อมูลแขก                   │
├──────────────────────────────┤
│  Guest Folio (ถ้า checked-in)│
├──────────────────────────────┤
│  ข้อมูลการชำระเงิน           │
├──────────────────────────────┤
│  ⭐ ประวัติกิจกรรม (NEW!)    │  ← เพิ่มตรงนี้
├──────────────────────────────┤
│  คำขอพิเศษ                   │
├──────────────────────────────┤
│  หมายเหตุ                    │
└──────────────────────────────┘
```

### 3.4 API Hook

**ไฟล์ใหม่:** `lib/hooks/useBookingActivities.ts`

```typescript
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

interface ActivityPerformer {
  id: string;
  name: string;
  role: string;
}

interface ActivityChange {
  from: string | number | null;
  to: string | number | null;
}

interface BookingActivity {
  id: string;
  action: string;
  actionLabel: string;
  description: string;
  performedBy: ActivityPerformer;
  timestamp: string;
  changes: Record<string, ActivityChange> | null;
  category: string;
  icon: string;
  color: string;
}

export function useBookingActivities(bookingId: string) {
  const [activities, setActivities] = useState<BookingActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = async () => {
    if (!bookingId) return;
    setIsLoading(true);
    try {
      const response = await apiClient.get(`/bookings/${bookingId}/activities`);
      setActivities(response.data?.activities || []);
    } catch (err) {
      setError('ไม่สามารถโหลดประวัติกิจกรรมได้');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchActivities(); }, [bookingId]);

  return { activities, isLoading, error, refetch: fetchActivities };
}
```

---

## 4. สรุปไฟล์ที่ต้องแก้ไข / เพิ่มใหม่

### Backend (owner-hotel-services-api)

| ไฟล์ | Action | รายละเอียด |
|------|--------|-----------|
| `src/audit-log/dto/audit-log.dto.ts` | **แก้ไข** | เพิ่ม AuditAction enum 9 ค่าใหม่ |
| `src/modules/bookings/bookings.service.ts` | **แก้ไข** | เพิ่ม audit logging ใน update, remove, earlyCheckin, lateCheckout, folio methods + เพิ่ม `getBookingActivities()` method + helper methods |
| `src/modules/bookings/bookings.controller.ts` | **แก้ไข** | เพิ่ม `GET /:id/activities` endpoint + ส่ง userId/ipAddress ไปยัง service methods |

### Frontend (owner-hotel-services)

| ไฟล์ | Action | รายละเอียด |
|------|--------|-----------|
| `components/bookings/BookingActivityTimeline.tsx` | **สร้างใหม่** | Activity timeline component พร้อม collapsible changes |
| `lib/hooks/useBookingActivities.ts` | **สร้างใหม่** | Custom hook สำหรับ fetch activities |
| `lib/types/index.ts` | **แก้ไข** | เพิ่ม BookingActivity, ActivityPerformer types |
| `app/dashboard/bookings/[id]/page.tsx` | **แก้ไข** | เพิ่ม `<BookingActivityTimeline>` ในหน้า detail |

---

## 5. Activity Tracking Coverage Matrix

ตาราง mapping ทุก action ที่ต้อง track ตลอด booking lifecycle:

| # | Action | AuditAction | Trigger Point | Data ที่เก็บ |
|---|--------|-------------|---------------|-------------|
| 1 | สร้างการจอง | `booking_create` | `create()` | guest, room, dates, price, source |
| 2 | ยืนยันการจอง | `booking_confirm` | `update(status→confirmed)` | old status → new status |
| 3 | แก้ไขการจอง | `booking_update` | `update()` (non-status) | changed fields (old → new) |
| 4 | ยกเลิกการจอง | `booking_cancel` | `remove()` | reason, old status |
| 5 | เช็คอิน | `booking_checkin` | `checkIn()` | actualCheckIn, room, guest |
| 6 | เช็คเอาท์ | `booking_checkout` | `checkOut()` | actualCheckOut, stayDuration, charges |
| 7 | ขอ Early Check-in | `booking_early_checkin_request` | `requestEarlyCheckIn()` | requested time, fee |
| 8 | อนุมัติ Early Check-in | `booking_early_checkin_approve` | `approveEarlyCheckIn()` | approved time, fee |
| 9 | ขอ Late Check-out | `booking_late_checkout_request` | `requestLateCheckOut()` | requested time, fee |
| 10 | อนุมัติ Late Check-out | `booking_late_checkout_approve` | `approveLateCheckOut()` | approved time, fee |
| 11 | เพิ่มค่าใช้จ่าย (Folio) | `booking_folio_charge` | `addFolioCharge()` | charge name, amount |
| 12 | ปิดยอด Folio | `booking_folio_finalize` | `finalizeFolio()` | total, items |
| 13 | ชำระเงิน | `booking_payment` | `handlePayment()` | method, amount, ref |
| 14 | อัปเดตหมายเหตุ | `booking_note_update` | `update(notes)` | old note → new note |
| 15 | แม่บ้านเสร็จ | `housekeeping_task_complete` | `completeTask()` | room, duration (related) |
| 16 | เปลี่ยนสถานะห้อง | `room_status_change` | `updateRoomStatus()` | old → new status (related) |

---

## 6. Implementation Priority

### Phase 1 — Core (ทำก่อน)
1. เพิ่ม audit log ใน `update()`, `remove()` (fix gaps)
2. สร้าง `GET /bookings/:id/activities` endpoint
3. สร้าง `BookingActivityTimeline` component
4. เพิ่มใน booking detail page

### Phase 2 — Extended Coverage
5. เพิ่ม audit log ใน early check-in/late check-out methods
6. เพิ่ม audit log ใน folio charge/finalize
7. เพิ่ม payment tracking ผูกกับ booking
8. แก้ userId จาก 'system' เป็น actual user

### Phase 3 — Polish
9. Related activities (housekeeping, room status)
10. Collapsible change details
11. Export activity log (PDF/CSV)
12. Real-time updates via WebSocket
