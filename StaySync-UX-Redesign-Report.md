# StaySync UX/UI Critical Redesign Report

**Date:** April 1, 2026
**Author:** Senior Product Designer & UX Architect
**Scope:** Full system redesign — Dashboard, Navigation, Workflows, Components
**Priority:** HIGH — Current system is developer-centric, not user-centric

---

## Executive Summary

จากการวิเคราะห์ codebase ทั้ง Frontend (68+ pages, 22 component domains, 20 Zustand stores) และ Backend (30+ modules, 150+ endpoints) พบปัญหา UX ที่ร้ายแรงหลายจุด:

1. **Dashboard แสดง data แต่ไม่มี actionable insight** — KPI cards 4 ใบ + recent bookings ไม่พอ ไม่มี "วันนี้ต้องทำอะไร"
2. **Navigation เป็น module-based** — Sidebar จัดตาม technical module (HR, Restaurant, Reports) ไม่ใช่ตาม workflow ของ staff
3. **Click depth สูงเกินไป** — Booking → Check-in ต้องผ่าน 4-5 clicks, Room status ต้องเข้า submenu
4. **Empty states แย่** — ใช้ generic "No data" ไม่มี CTA ที่ชัดเจน
5. **Onboarding ไม่ guide user** — Checklist 8 items แต่ไม่มี step-by-step wizard ที่จับมือทำ
6. **ไม่มี real-time operational feel** — ไม่มี live updates, ไม่มี today's timeline
7. **Trial experience ไม่สื่อ value** — Banner + badge ไม่พอ ไม่มี progress ที่ทำให้รู้สึกว่า "ต้องใช้ต่อ"

---

## 1. REDESIGN DASHBOARD — "Action Dashboard"

### ปัญหาปัจจุบัน

Dashboard ปัจจุบันใน `app/dashboard/page.tsx` มี:
- KPI Cards 4 ใบ (Vacant rooms, Check-ins, Total bookings, Occupancy) — ไม่มี context
- Onboarding Checklist — ดีแต่ layout กินพื้นที่
- Quick Actions 4 ปุ่ม (Getting started, Bookings, Guests, Reports) — generic เกินไป
- Recent Bookings 4 รายการ — ไม่มี action ต่อ
- Usage Statistics — ไม่ actionable

### Redesign: "Action Dashboard" Layout

```
┌─────────────────────────────────────────────────────────┐
│ HEADER: Today is Wednesday, 1 Apr 2026 | Property: XXX  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ ┌─── TODAY'S ACTION ITEMS (HERO SECTION) ────────────┐ │
│ │                                                     │ │
│ │  🔴 3 Check-ins due    🔵 2 Check-outs due         │ │
│ │  🟡 5 Rooms to clean   🟢 1 Payment pending        │ │
│ │                                                     │ │
│ │  [Quick: New Booking] [Check-in] [Room Status]      │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─── PRIMARY METRICS (4 CARDS) ──────────────────────┐ │
│ │ Occupancy  │ ADR         │ RevPAR     │ Revenue    │ │
│ │ 78% ↑5%    │ ฿2,450 ↑3% │ ฿1,911     │ ฿48,200   │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─── SECONDARY METRICS (4 MINI CARDS) ───────────────┐ │
│ │ Arrivals:8 │ Departures:5│ In-house:32│ Avail:12  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ┌─── TODAY'S TIMELINE ──────┐ ┌─── ACTIVITY FEED ────┐ │
│ │ 09:00 Check-in: John D.   │ │ 5m ago: Room 301     │ │
│ │ 10:00 Check-in: Maria S.  │ │   cleaned → VC       │ │
│ │ 11:00 Check-out: Peter K. │ │ 12m ago: Booking     │ │
│ │ 14:00 Check-in: Yuki T.   │ │   #1234 confirmed    │ │
│ │ [View all arrivals →]      │ │ 30m ago: Payment     │ │
│ │                            │ │   ฿4,500 received    │ │
│ └────────────────────────────┘ └──────────────────────┘ │
│                                                         │
│ ┌─── ROOM STATUS HEATMAP (MINI) ────────────────────┐  │
│ │ Floor 1: [301🟢][302🔵][303🟢][304🟡][305🔴]     │  │
│ │ Floor 2: [401🔵][402🔵][403🟢][404🟢][405🟢]     │  │
│ │ [Open full room map →]                              │  │
│ └─────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌─── SUPPORTING DATA ───────────────────────────────┐   │
│ │ Housekeeping Tasks: 5/12 done │ Pending Payments: 3│  │
│ │ Maintenance Requests: 1       │ Guest Reviews: 4.5★│  │
│ └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Information Hierarchy (ชัดเจน)

**Level 1 — HERO (ต้องเห็นก่อน):**
- Today's Action Items: สิ่งที่ต้องทำวันนี้ (check-ins due, check-outs due, rooms to clean, payments pending)
- Quick Action Buttons: ปุ่มหลัก 3 ปุ่ม (New Booking, Check-in, Room Status)

**Level 2 — PRIMARY METRICS (KPIs):**
- Occupancy Rate + trend
- ADR (Average Daily Rate) + trend
- RevPAR (Revenue Per Available Room)
- Today's Revenue

**Level 3 — SECONDARY METRICS:**
- Arrivals today / Departures today / In-house guests / Available rooms

**Level 4 — OPERATIONAL DATA:**
- Today's Timeline (chronological check-in/out schedule)
- Activity Feed (real-time log of recent events)
- Mini Room Heatmap (visual room status)

**Level 5 — SUPPORTING DATA:**
- Housekeeping progress / Pending payments / Maintenance / Reviews

### Role-Based Dashboard Variants

| Role | Hero Section | Primary Metrics | Operational Data |
|------|-------------|-----------------|-----------------|
| **Manager/Owner** | Revenue alerts + Action items | Occupancy, ADR, RevPAR, Revenue | Full timeline + Activity feed |
| **Receptionist** | Check-in/out queue | Arrivals, Departures, In-house, Available | Timeline + Room status |
| **Housekeeper** | Today's task list (rooms to clean) | Tasks done/total, Priority rooms | Room status grid only |
| **Chef/Waiter** | Active orders, pending orders | Table occupancy, Average order time | Kitchen queue |

### API Endpoints ที่ต้องใช้ (Backend)

```
GET /api/v1/dashboard/today-actions     — Action items สำหรับวันนี้
GET /api/v1/dashboard/metrics           — KPIs (occupancy, ADR, RevPAR, revenue)
GET /api/v1/dashboard/timeline          — Today's timeline (arrivals/departures)
GET /api/v1/dashboard/activity-feed     — Recent activities (real-time via WebSocket)
GET /api/v1/dashboard/room-heatmap      — Room status summary by floor
GET /api/v1/rooms?status=all            — ใช้ endpoint เดิม (มีแล้ว)
GET /api/v1/bookings?checkInDate=today  — ใช้ endpoint เดิม + filter (มีแล้ว)
```

**Endpoints ที่ต้องสร้างใหม่:** `today-actions`, `metrics`, `timeline`, `activity-feed`, `room-heatmap`

---

## 2. REDESIGN NAVIGATION — Task-Based Menu

### ปัญหาปัจจุบัน

Sidebar ใน `components/layout/Sidebar.tsx` จัดแบบ module-based:
```
Current:
├── Dashboard
├── Departments → HR, Restaurant (ซ่อนอยู่ใน submenu)
├── Finance & Admin → Reports, Payments, Settings (ซ่อนอยู่ใน submenu)
```

ปัญหา: Receptionist ต้อง click "Departments" เพื่อหา Booking? ไม่ make sense. HR อยู่ใต้ "Departments" ทั้งๆ ที่เป็นคนละ workflow กับ Restaurant.

### Redesign: Task-Based Navigation

```
NEW SIDEBAR STRUCTURE:
─────────────────────────
📊  Dashboard                    ← Action Dashboard (หน้าหลัก)
─────────────────────────
🏨  OPERATIONS (งานประจำวัน)
    📅  Bookings                 ← Calendar + List + New Booking
    🚪  Front Desk               ← Check-in/out queue, walk-in
    🛏️  Rooms                    ← Room map, status grid, inventory
    👥  Guests                   ← Guest database, profiles
    🧹  Housekeeping             ← Task board, assignments
─────────────────────────
💰  REVENUE (เงินๆ ทอง)
    💳  Payments                 ← Transactions, PromptPay
    📊  Reports                  ← Revenue, Occupancy, Custom
    📢  Channels                 ← OTA management
─────────────────────────
🍽️  F&B (ร้านอาหาร)
    🍽️  Restaurant               ← Orders, Tables
    📋  Menu                     ← Menu management
    🏭  Kitchen                  ← KDS (Kitchen Display)
─────────────────────────
👔  MANAGEMENT (จัดการ)
    👨‍💼  Staff (HR)               ← Employees, Attendance, Payroll
    ⭐  Reviews                  ← Guest feedback
    🔔  Notifications            ← All alerts
    ⚙️  Settings                 ← Property, Security, Integrations
─────────────────────────
```

### ทำไมดีกว่า

1. **Operations** อยู่บนสุด — งานที่ทำบ่อยที่สุด (Bookings, Front Desk, Rooms) เข้าถึงได้ทันที
2. **ไม่ซ่อนใน submenu** — ทุก section expand ได้โดยไม่ต้อง click
3. **จัดกลุ่มตาม workflow** ไม่ใช่ตาม technical module
4. **Front Desk เป็น dedicated section** — Receptionist ไม่ต้องหาว่า check-in อยู่ตรงไหน
5. **Revenue แยกชัด** — Manager ดูตัวเลขได้ง่าย

### Keyboard Shortcuts

```
Cmd+K          → Global Search (Guest, Booking, Room)
Cmd+N          → New Booking
Cmd+Shift+I    → Quick Check-in
Cmd+Shift+O    → Quick Check-out
Cmd+R          → Room Status
```

### API Endpoints ที่เกี่ยวข้อง

ไม่ต้องสร้าง endpoint ใหม่ — Navigation ใช้ frontend routing เท่านั้น. แต่ต้อง refactor routes:

```
Current Routes → New Routes:
/dashboard/hotels/[id]/hr/*         → /dashboard/staff/*
/dashboard/hotels/[id]/restaurant/* → /dashboard/restaurant/*
/dashboard/rooms/housekeeping       → /dashboard/housekeeping
/dashboard/front-desk               → /dashboard/front-desk (มีแล้ว ✓)
```

---

## 3. CORE WORKFLOW DESIGN

### Main Flow: Guest → Booking → Room → Services → Checkout → Report

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Guest   │───>│ Booking  │───>│   Room    │───>│ Services │───>│ Checkout │───>│ Report   │
│ Profile  │    │ Created  │    │ Assigned  │    │  Added   │    │ Finalize │    │ Revenue  │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │                │               │               │
  Endpoints:      Endpoints:      Endpoints:       Endpoints:     Endpoints:      Endpoints:
  POST guests/   POST bookings/  PATCH rooms/     POST bookings/  POST bookings/  GET reports/
  GET guests/    GET bookings/   :id/status       :id/folio/      :id/folio/      revenue
  PUT guests/:id PUT bookings/                    charges         finalize        GET reports/
                 :id                                              POST bookings/  occupancy
                                                                  :id/checkout
```

### Step 1: Guest Profile (สร้าง/ค้นหาแขก)

**UI:** Global Search (Cmd+K) → พิมพ์ชื่อ/เบอร์โทร → autocomplete จาก guest database → ถ้าไม่มี → "Create New Guest" inline

**Endpoints ที่ใช้:**
- `GET /api/v1/guests?search=<query>` — ค้นหา guest
- `POST /api/v1/guests` — สร้าง guest ใหม่
- `GET /api/v1/guests/:id` — ดู profile

**UX Improvement:** ปัจจุบัน GuestForm.tsx เป็น full-page form → เปลี่ยนเป็น **slide-over panel** ที่เปิดจากขวามือได้ทันทีจากทุกหน้า

### Step 2: Booking Created (สร้าง reservation)

**UI:** Step-based Wizard (3 steps)
```
Step 1: Dates & Room Type    → Date picker + room type selector + auto-show available rooms
Step 2: Guest Selection      → Search existing or create new (from Step 1)
Step 3: Confirm & Payment    → Summary + payment method + channel source
```

**Endpoints ที่ใช้:**
- `GET /api/v1/rooms/available?checkIn=&checkOut=&type=` — ดูห้องว่าง
- `POST /api/v1/bookings` — สร้าง booking
- `GET /api/v1/bookings/:id` — ดูรายละเอียด

**UX Improvement:** ปัจจุบัน BookingForm.tsx เป็น single long form → เปลี่ยนเป็น **3-step wizard** ที่แสดง available rooms real-time เมื่อเลือกวันที่

### Step 3: Room Assignment (จัดห้อง)

**UI:** Visual Room Map + Drag-and-Drop
```
Booking Panel (ซ้าย)          Room Grid (ขวา)
┌─────────────────┐           ┌────┬────┬────┐
│ John D.         │  drag →   │301 │302 │303 │
│ Deluxe, 2 nights│  ───────> │ 🟢 │ 🔵 │ 🟢 │ ← drop ที่ห้อง 303
│ Check-in: Today │           ├────┼────┼────┤
└─────────────────┘           │401 │402 │403 │
                              │ 🟢 │ 🟡 │ 🟢 │
                              └────┴────┴────┘
```

**Endpoints ที่ใช้:**
- `GET /api/v1/rooms?status=available` — ห้องว่าง
- `PATCH /api/v1/rooms/:id/status` — อัพเดทสถานะห้อง
- `PUT /api/v1/bookings/:id` — assign room to booking

**UX Improvement:** ปัจจุบัน RoomMap.tsx มีอยู่แล้วแต่ไม่ได้เชื่อมกับ booking flow → **integrate drag-and-drop** จาก booking list ไปยัง room map

### Step 4: Services (เพิ่มค่าใช้จ่าย)

**UI:** Guest Folio Panel — slide-over ที่แสดงค่าใช้จ่ายทั้งหมดของแขก

**Endpoints ที่ใช้:**
- `POST /api/v1/bookings/:id/folio/charges` — เพิ่ม charge
- `GET /api/v1/bookings/:id/folio` — ดู folio ทั้งหมด

**UX Improvement:** ปัจจุบัน GuestFolio.tsx มีอยู่แล้ว แต่ต้อง navigate ไปหน้า booking detail → **ทำให้เปิดเป็น panel** จากทุกที่ที่เห็นชื่อ guest

### Step 5: Checkout (เช็คเอาท์)

**UI:** Checkout Wizard
```
Step 1: Review Folio       → แสดงค่าใช้จ่ายทั้งหมด + minibar + restaurant
Step 2: Payment            → เลือกวิธีจ่าย (Cash/Card/PromptPay/Transfer)
Step 3: Complete           → พิมพ์ใบเสร็จ + อัพเดทสถานะห้อง → Dirty
```

**Endpoints ที่ใช้:**
- `GET /api/v1/bookings/:id/checkout-summary` — สรุปค่าใช้จ่าย
- `POST /api/v1/bookings/:id/folio/finalize` — finalize folio
- `POST /api/v1/bookings/:id/checkout` — check-out
- `POST /api/v1/payments` — บันทึกการจ่ายเงิน
- `POST /api/v1/payments/promptpay/generate-qr` — QR PromptPay

**UX Improvement:** ปัจจุบัน CheckOutFlow.tsx มีอยู่แล้ว — ต้องให้ accessible จาก dashboard timeline ด้วย 1 click

### Step 6: Reporting (ดูรายงาน)

**Endpoints ที่ใช้:**
- `GET /api/v1/reports/revenue` — รายงานรายได้
- `GET /api/v1/reports/occupancy` — รายงาน occupancy
- `POST /api/v1/reports/export` — export Excel/CSV/PDF

---

## 4. EMPTY STATES REDESIGN

### ปัญหาปัจจุบัน

EmptyState.tsx component มีอยู่แล้วแต่ใช้ generic message. ต้องให้ **specific ต่อ context** และมี **CTA ที่ชัดเจน**

### Empty State ต่อ Module

#### Bookings (ไม่มี booking)
```
🗓️ [Calendar illustration]

"ยังไม่มี booking — เริ่มรับจองเลย!"
"สร้าง booking แรกเพื่อเริ่มจัดการการจองของโรงแรมคุณ"

[➕ สร้าง Booking แรก]          [📖 ดูวิธีใช้งาน]
```

#### Rooms (ไม่มีห้อง)
```
🛏️ [Room illustration]

"ยังไม่มีห้องพัก — เพิ่มห้องเพื่อเริ่มใช้งาน"
"เพิ่มห้องพักพร้อมราคาและรายละเอียด เพื่อเปิดรับจอง"

[➕ เพิ่มห้องแรก]               [📥 Import จาก Excel]
```

#### Guests (ไม่มี guest)
```
👥 [People illustration]

"ยังไม่มีข้อมูลแขก"
"ข้อมูลแขกจะถูกสร้างอัตโนมัติเมื่อมีการจอง หรือเพิ่มเองได้"

[➕ เพิ่มแขก]                   [📅 สร้าง Booking]
```

#### Housekeeping (ไม่มี task)
```
🧹 [Sparkle illustration]

"ทุกห้องสะอาดเรียบร้อย! 🎉"
"ไม่มีงานทำความสะอาดค้าง — จะมี task ใหม่เมื่อแขก check-out"

[🛏️ ดูสถานะห้อง]               [📊 ดูสถิติ Housekeeping]
```

#### Payments (ไม่มี payment)
```
💳 [Payment illustration]

"ยังไม่มีรายการชำระเงิน"
"รายการจะปรากฏเมื่อมีการรับชำระค่าห้อง หรือบันทึกการรับเงินเอง"

[💰 บันทึกการรับเงิน]           [📅 ดู Bookings]
```

#### Reports (ยังไม่มี data)
```
📊 [Chart illustration]

"ยังไม่มีข้อมูลเพียงพอสำหรับรายงาน"
"เริ่มสร้าง booking และรับชำระเงินเพื่อให้ระบบสร้างรายงานให้คุณ"

[📅 สร้าง Booking]              [📥 Import ข้อมูล]
```

#### Staff/HR (ไม่มี employee)
```
👔 [Team illustration]

"ยังไม่มีข้อมูลพนักงาน"
"เพิ่มพนักงานเพื่อจัดการตารางงาน เงินเดือน และการลา"

[➕ เพิ่มพนักงานคนแรก]          [📥 Import จาก Excel]
```

#### Restaurant (ไม่มี menu)
```
🍽️ [Menu illustration]

"ยังไม่มีเมนูอาหาร"
"เพิ่มเมนูเพื่อเริ่มรับออเดอร์จากแขกและพนักงาน"

[➕ สร้างเมนูแรก]               [📋 ดู Template เมนู]
```

---

## 5. QUICK ACTIONS SYSTEM

### Design: Global Quick Action Bar + Command Palette

#### Option A: Floating Quick Action Bar (Sticky Top-Right)

```
┌──────────────────────────────────────────────────┐
│  [➕ New Booking] [🚪 Check-in] [📤 Check-out]   │
│  [🛏️ Room Status] [👤 Add Guest]                 │
└──────────────────────────────────────────────────┘
```

แสดงที่ top-right ของทุกหน้าใน dashboard. บน mobile เปลี่ยนเป็น FAB (Floating Action Button) ที่มุมล่างขวา.

#### Option B: Command Palette (Cmd+K)

```
┌─────────────────────────────────────┐
│ 🔍 Search or type a command...      │
├─────────────────────────────────────┤
│ QUICK ACTIONS                       │
│  📅  Create new booking             │
│  🚪  Check-in guest                 │
│  📤  Check-out guest                │
│  🛏️  Add new room                   │
│  👤  Add new guest                  │
│  👔  Add new employee               │
├─────────────────────────────────────┤
│ RECENT                              │
│  👤  John Doe (Guest #1234)         │
│  📅  Booking #5678 - Room 301      │
├─────────────────────────────────────┤
│ NAVIGATION                          │
│  Go to Bookings                     │
│  Go to Room Status                  │
│  Go to Reports                      │
└─────────────────────────────────────┘
```

### แนะนำ: ใช้ทั้ง 2 แบบ

- **Quick Action Bar** → สำหรับ Receptionist ที่ต้องการปุ่มกดเร็ว (ไม่ใช้ keyboard)
- **Command Palette (Cmd+K)** → สำหรับ Manager/Power user ที่ชอบ keyboard

### Endpoints ที่ Quick Actions เรียก

| Quick Action | Endpoint | Method |
|---|---|---|
| Create Booking | `POST /api/v1/bookings` | POST |
| Check-in | `POST /api/v1/bookings/:id/checkin` | POST |
| Check-out | `POST /api/v1/bookings/:id/checkout` | POST |
| Add Room | `POST /api/v1/rooms` | POST |
| Add Guest | `POST /api/v1/guests` | POST |
| Add Employee | `POST /api/v1/hr` | POST |
| Search | `GET /api/v1/guests?search=` + `GET /api/v1/bookings?search=` + `GET /api/v1/rooms?search=` | GET |

---

## 6. ONBOARDING REDESIGN

### ปัญหาปัจจุบัน

- WelcomeModal.tsx → แสดงแค่ข้อความต้อนรับ + trial info
- OnboardingChecklist.tsx → 8 items แต่ไม่ guide ว่าทำยังไง
- GuidedTour.tsx → highlight elements แต่ไม่ได้จับมือทำจริง

### Redesign: Step-by-Step Guided Wizard

เปลี่ยนจาก checklist → **interactive wizard ที่จับมือทำทีละ step**

```
ONBOARDING WIZARD (5 Steps):

Step 1/5: ตั้งค่าโรงแรม
┌─────────────────────────────────────┐
│  🏨 ตั้งค่าโรงแรมของคุณ             │
│                                     │
│  ชื่อโรงแรม: [________________]     │
│  ที่อยู่:    [________________]     │
│  จำนวนชั้น: [__]                    │
│                                     │
│  ✅ กรอกข้อมูลเสร็จ ระบบจะสร้าง    │
│     property ให้อัตโนมัติ           │
│                                     │
│            [ถัดไป →]                │
│                                     │
│  ●○○○○ Step 1 of 5                  │
└─────────────────────────────────────┘

Step 2/5: เพิ่มห้องพัก
┌─────────────────────────────────────┐
│  🛏️ เพิ่มห้องพักแรก                 │
│                                     │
│  ประเภท: [Deluxe ▾]                │
│  เลขห้อง: [301]                    │
│  ราคา/คืน: [1,500]                 │
│  จำนวนห้อง: [10]                   │
│                                     │
│  💡 Tip: เพิ่มห้องทีเดียวหลายห้อง  │
│     ได้ หรือ import จาก Excel       │
│                                     │
│  [← ย้อนกลับ]     [ถัดไป →]        │
│                                     │
│  ●●○○○ Step 2 of 5                  │
└─────────────────────────────────────┘

Step 3/5: ตั้งค่าราคา
Step 4/5: เชื่อมต่อ Channels (optional)
Step 5/5: สร้าง Booking แรก (hands-on)
```

### Feedback ทันทีทุก Step

- Step สำเร็จ → animation checkmark ✅ + "เยี่ยมมาก!" message
- Step ข้าม → gentle nudge "คุณสามารถกลับมาทำทีหลังได้"
- ทุก step → progress bar + "เหลืออีก X steps"

### Endpoints สำหรับ Onboarding

- `GET /api/v1/onboarding/progress` — ดู progress (มีแล้ว ✓)
- `PATCH /api/v1/onboarding/step/:id` — อัพเดท step (มีแล้ว ✓)
- `POST /api/v1/tenants/hotels` — สร้างโรงแรม (Step 1)
- `POST /api/v1/rooms` — สร้างห้อง (Step 2)
- `POST /api/v1/bookings` — สร้าง booking (Step 5)

---

## 7. INFORMATION HIERARCHY

### ปัญหาปัจจุบัน

ทุกอย่างบน dashboard มีขนาดเท่ากัน — KPI cards เท่ากับ recent bookings เท่ากับ usage stats. ไม่มี visual hierarchy.

### Redesign: 3-Level Hierarchy

**Level 1 — HERO (ขนาดใหญ่, สีเด่น, อยู่บนสุด)**
- Today's Action Items → ใช้ card ขนาดใหญ่ สีพื้นหลัง primary-50 มี border-left primary-600
- ตัวเลข action ใช้ font 2rem bold
- Quick action buttons ใช้ primary CTA style

**Level 2 — PRIMARY METRICS (ขนาดกลาง, อยู่ถัดจาก Hero)**
- KPI Cards 4 ใบ → ใช้ StatsCard ปัจจุบัน แต่เพิ่ม trend arrow + sparkline chart
- Font: 1.5rem bold สำหรับตัวเลข, 0.875rem สำหรับ label
- สี: ใช้ semantic colors ตาม context (green = good, red = bad)

**Level 3 — SECONDARY METRICS (ขนาดเล็ก, compact)**
- Mini cards → ใช้ MiniStatsCard (มีอยู่แล้ว)
- Font: 1rem bold สำหรับตัวเลข, 0.75rem สำหรับ label
- สี: neutral, ไม่แย่งความสนใจจาก Level 1-2

**Level 4 — OPERATIONAL (ตาราง/list, scroll ได้)**
- Timeline, Activity Feed → ใช้ compact list view
- Room Heatmap → visual grid ขนาดเล็ก

**Level 5 — SUPPORTING (ซ่อนบางส่วน, expand on demand)**
- Detailed stats, historical data → collapse by default

### Typography Scale

```
Hero Number:    2rem (32px), font-weight 700, text-gray-900
Primary Number: 1.5rem (24px), font-weight 700, text-gray-900
Secondary:      1rem (16px), font-weight 600, text-gray-700
Label:          0.75rem (12px), font-weight 500, text-gray-500, uppercase
Body:           0.875rem (14px), font-weight 400, text-gray-600
```

---

## 8. UI PATTERNS

### 8.1 Cards vs Tables vs Maps — เมื่อไหร่ใช้อะไร

| Pattern | ใช้เมื่อ | ตัวอย่างใน StaySync |
|---------|---------|---------------------|
| **Cards** | ข้อมูลน้อย, ต้อง visual impact, scan เร็ว | KPI metrics, Booking summary, Guest profile card |
| **Tables** | ข้อมูลเยอะ, ต้อง sort/filter/compare | Booking list, Guest list, Payment transactions, HR employees |
| **Grid/Map** | ต้องเห็น spatial layout, status overview | Room status grid, Restaurant table map, Floor plan |
| **Timeline** | ข้อมูลเรียงตามเวลา | Today's arrivals/departures, Activity feed, Audit log |
| **Kanban** | ข้อมูลที่มี status flow | Housekeeping tasks (Pending → In Progress → Done) |

### 8.2 Room Map (Visual Floor Plan)

```
ROOM STATUS MAP — Floor 1
┌──────┬──────┬──────┬──────┬──────┐
│ 101  │ 102  │ 103  │ 104  │ 105  │
│ STD  │ STD  │ DLX  │ DLX  │ STE  │
│  🟢  │  🔵  │  🟢  │  🟡  │  🔴  │
│  VC  │  OC  │  VC  │  VD  │ OOO  │
└──────┴──────┴──────┴──────┴──────┘

Legend:
🟢 VC (Vacant Clean)    — พร้อมเข้าพัก
🔵 OC (Occupied Clean)  — มีแขก
🟡 VD (Vacant Dirty)    — ต้องทำความสะอาด
🔴 OOO (Out of Order)   — ซ่อมบำรุง
⚪ OD (Occupied Dirty)   — แขกอยู่+ต้องทำสะอาด

Click ที่ห้อง → Slide-over panel:
┌─────────────────────────┐
│ Room 103 — Deluxe       │
│ Status: Vacant Clean 🟢 │
│ Rate: ฿2,500/night      │
│ Floor: 1 | View: Garden │
│                         │
│ [📅 Book This Room]     │
│ [🧹 Request Cleaning]   │
│ [🔧 Report Issue]       │
└─────────────────────────┘
```

### 8.3 Status Colors (Consistent across entire app)

```
Room Status:
  VC (Vacant Clean)      → bg-green-100 text-green-700 border-green-300
  VD (Vacant Dirty)      → bg-amber-100 text-amber-700 border-amber-300
  OC (Occupied Clean)    → bg-blue-100 text-blue-700 border-blue-300
  OD (Occupied Dirty)    → bg-orange-100 text-orange-700 border-orange-300
  OOO (Out of Order)     → bg-red-100 text-red-700 border-red-300

Booking Status:
  Confirmed              → bg-green-100 text-green-700
  Pending                → bg-amber-100 text-amber-700
  Checked-in             → bg-blue-100 text-blue-700
  Checked-out            → bg-gray-100 text-gray-700
  Cancelled              → bg-red-100 text-red-700
  No-show                → bg-red-50 text-red-600

Payment Status:
  Paid                   → bg-green-100 text-green-700
  Pending                → bg-amber-100 text-amber-700
  Overdue                → bg-red-100 text-red-700
  Partial                → bg-blue-100 text-blue-700
  Refunded               → bg-gray-100 text-gray-700

Housekeeping:
  Pending                → bg-amber-100 text-amber-700
  In Progress            → bg-blue-100 text-blue-700
  Completed              → bg-green-100 text-green-700
  Inspected              → bg-purple-100 text-purple-700
```

### 8.4 Real-Time Indicators

```
Live Indicators:
  🔴 (pulse animation)   → Urgent: overdue check-out, payment failed
  🟡 (pulse animation)   → Warning: check-in in 30 min, room not ready
  🟢 (static)            → Good: everything normal

Connection Status:
  "● Live" (green dot)   → WebSocket connected, real-time updates active
  "● Offline" (red dot)  → WebSocket disconnected, showing cached data
```

---

## 9. COMPONENT IMPROVEMENTS

### 9.1 Button — เพิ่ม Contextual Variants

ปัจจุบันมี: primary, secondary, outline, ghost, danger, success

**เพิ่ม:**
```tsx
// Icon-only button (สำหรับ table action columns)
<Button variant="ghost" size="icon" tooltip="Edit">
  <Pencil size={16} />
</Button>

// Button with badge count (สำหรับ notification-like actions)
<Button variant="outline" badge={3}>
  Pending Check-ins
</Button>

// Loading state improvement (แสดง progress text)
<Button isLoading loadingText="กำลังบันทึก...">
  Save
</Button>

// Split button (primary action + dropdown)
<SplitButton
  primary={{ label: "Check-in", onClick: handleCheckin }}
  options={[
    { label: "Check-in + Print Key Card", onClick: ... },
    { label: "Check-in + Send Welcome SMS", onClick: ... },
  ]}
/>
```

### 9.2 Card — เพิ่ม Interactive Variants

**เพิ่ม:**
```tsx
// Clickable card (สำหรับ room grid)
<Card variant="interactive" onClick={openRoom} status="success">
  <RoomNumber>301</RoomNumber>
  <RoomType>Deluxe</RoomType>
  <StatusDot color="green" />
</Card>

// KPI Card with sparkline
<KpiCard
  title="Occupancy"
  value="78%"
  trend={{ value: 5, direction: "up" }}
  sparkline={[65, 70, 68, 75, 78]}  // 7-day mini chart
/>

// Alert Card (สำหรับ action items)
<AlertCard severity="warning">
  <AlertTitle>3 ห้องยังไม่พร้อม</AlertTitle>
  <AlertDescription>Room 301, 405, 502 ยังไม่ทำความสะอาด</AlertDescription>
  <AlertAction onClick={openHousekeeping}>จัดการ →</AlertAction>
</AlertCard>
```

### 9.3 Modal — เพิ่ม Slide-Over Panel

**ปัญหา:** ทุก action เปิด full modal ทับ content → เสีย context

**เพิ่ม:**
```tsx
// Slide-over panel (เปิดจากขวา ไม่บัง content ซ้าย)
<SlideOver isOpen={isOpen} onClose={close} title="Guest Details" width="md">
  <GuestProfile guestId={selectedGuest} />
  <GuestFolio bookingId={activeBooking} />
</SlideOver>

// Sizes: sm (320px), md (480px), lg (640px), xl (800px)
// ใช้แทน modal สำหรับ: guest detail, room detail, booking detail, folio
```

### 9.4 Badge — เพิ่ม Animated + Contextual

```tsx
// Animated badge (สำหรับ urgent items)
<Badge variant="danger" pulse>Overdue</Badge>

// Badge with icon
<Badge variant="info" icon={<Clock size={12} />}>In 30 min</Badge>

// Removable badge (สำหรับ filter chips)
<Badge variant="outline" removable onRemove={clearFilter}>Deluxe</Badge>
```

### 9.5 StatsCard — เพิ่ม Sparkline + Goal

```tsx
<StatsCard
  title="Monthly Revenue"
  value="฿1.2M"
  trend={{ value: 12, label: "vs last month" }}
  sparkline={[800, 950, 1100, 1050, 1200]}
  goal={{ target: 1500000, label: "Target: ฿1.5M" }}
  color="green"
/>
```

### 9.6 Input — เพิ่ม Specialized Inputs

```tsx
// Date Range Picker (สำหรับ booking dates)
<DateRangePicker
  checkIn={checkIn}
  checkOut={checkOut}
  onChange={setDates}
  minDate={today}
  blockedDates={bookedDates}
/>

// Guest Search Input (autocomplete from database)
<GuestSearchInput
  onSelect={setGuest}
  onCreate={openNewGuestForm}
  placeholder="ค้นหาชื่อแขก, เบอร์โทร, อีเมล..."
/>

// Currency Input (สำหรับราคา/payment)
<CurrencyInput
  value={amount}
  onChange={setAmount}
  currency="THB"
  prefix="฿"
/>

// Room Number Input (with floor validation)
<RoomNumberInput
  value={roomNumber}
  onChange={setRoom}
  floors={[1, 2, 3, 4]}
/>
```

---

## 10. REDUCE CLICK DEPTH

### Current vs Redesign Click Count

| Action | Current Clicks | Redesign Clicks | How |
|--------|---------------|-----------------|-----|
| **New Booking** | 3-4 (Dashboard → Bookings → New → Fill form) | **1** (Quick Action button or Cmd+N) |
| **Check-in Guest** | 4-5 (Bookings → Find booking → Open → Click check-in → Confirm) | **2** (Dashboard action item → Confirm) |
| **Check-out Guest** | 5-6 (Bookings → Find → Open → Checkout → Review → Confirm) | **2** (Dashboard timeline → Confirm checkout) |
| **View Room Status** | 2-3 (Sidebar → Rooms → Room Status) | **1** (Dashboard mini heatmap or Cmd+R) |
| **Add Folio Charge** | 4-5 (Bookings → Find → Open → Folio tab → Add charge) | **2** (Click guest name anywhere → Slide-over folio → Add) |
| **Change Room Status** | 3-4 (Rooms → Find room → Click → Change status) | **1** (Click room on map → Dropdown status change) |
| **View Today's Revenue** | 3 (Reports → Revenue → Filter today) | **0** (On dashboard, visible immediately) |
| **Search Guest** | 2-3 (Guests → Search bar → Type) | **1** (Cmd+K → Type) |

### Principles Applied

1. **Dashboard เป็น launchpad** — ทุก action ที่ทำบ่อย เริ่มจาก dashboard ได้ทันที
2. **Command Palette (Cmd+K)** — ทุก search/action เข้าถึงได้ 1 keystroke
3. **Slide-Over Panels** — ดู detail โดยไม่ออกจากหน้าปัจจุบัน
4. **Inline Actions** — เปลี่ยน status, เพิ่ม charge ได้ทันทีจาก list/grid ไม่ต้องเปิดหน้าใหม่
5. **Smart Defaults** — วันที่ default = วันนี้, ห้อง default = ห้องว่างแรก, etc.

---

## 11. TRIAL EXPERIENCE IMPROVEMENT

### ปัญหาปัจจุบัน

- TrialBanner.tsx แสดงวันเหลือ + ปุ่ม Upgrade → ไม่สร้าง urgency
- TrialBenefitsCard.tsx แสดง usage stats → ไม่ connect value

### Redesign: Value-Driven Trial Experience

```
TRIAL BANNER (วันที่ 1-7): Gentle
┌─────────────────────────────────────────────────────────┐
│ 🎁 ยินดีต้อนรับ! คุณมี 14 วันทดลองใช้ฟรี              │
│    Complete setup เพื่อปลดล็อคทุก feature                │
│                                    [เริ่มตั้งค่า →]      │
└─────────────────────────────────────────────────────────┘

TRIAL BANNER (วันที่ 8-12): Value showcase
┌─────────────────────────────────────────────────────────┐
│ 📊 สัปดาห์ที่ผ่านมาคุณใช้ StaySync จัดการ:             │
│    ✅ 15 bookings  ✅ 28 check-ins  ✅ ฿125,000 revenue  │
│    เหลืออีก 6 วัน — อัพเกรดเพื่อไม่สูญเสียข้อมูลเหล่านี้│
│                                    [ดูแผนราคา →]        │
└─────────────────────────────────────────────────────────┘

TRIAL BANNER (วันที่ 13-14): Urgency
┌─────────────────────────────────────────────────────────┐
│ ⚠️ เหลืออีก 1 วัน! ข้อมูล 15 bookings จะถูก lock       │
│    อัพเกรดวันนี้ได้ส่วนลด 20% สำหรับ 3 เดือนแรก        │
│                     [อัพเกรดตอนนี้ →] [เตือนฉันอีกครั้ง] │
└─────────────────────────────────────────────────────────┘
```

### Endpoints ที่ใช้

- `GET /api/v1/onboarding/tenant/:tenantId/trial-status` — trial status (มีแล้ว ✓)
- `GET /api/v1/subscriptions/tenant/:tenantId` — subscription info (มีแล้ว ✓)
- `GET /api/v1/analytics/summary` — usage stats (มีแล้ว ✓)

---

## ENDPOINT SUMMARY — สำหรับตรวจงาน

### Endpoints ที่มีอยู่แล้ว (ใช้ได้เลย)

#### AUTH (6 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | POST | `/api/v1/auth/register` | Register new user |
| 2 | POST | `/api/v1/auth/login` | Login |
| 3 | POST | `/api/v1/auth/admin/login` | Admin login |
| 4 | POST | `/api/v1/auth/refresh` | Refresh token |
| 5 | POST | `/api/v1/auth/forgot-password` | Forgot password |
| 6 | POST | `/api/v1/auth/reset-password` | Reset password |
| 7 | POST | `/api/v1/auth/logout` | Logout |

#### 2FA (7 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 8 | POST | `/api/v1/auth/2fa/enable` | Enable 2FA |
| 9 | POST | `/api/v1/auth/2fa/verify` | Verify 2FA |
| 10 | POST | `/api/v1/auth/2fa/disable` | Disable 2FA |
| 11 | GET | `/api/v1/auth/2fa/status` | 2FA status |
| 12 | GET | `/api/v1/auth/2fa/backup-codes` | Backup codes |
| 13 | POST | `/api/v1/auth/2fa/verify-backup` | Verify backup code |
| 14 | POST | `/api/v1/auth/2fa/validate` | Validate 2FA during login |

#### USERS (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 15 | GET | `/api/v1/users` | List users |
| 16 | GET | `/api/v1/users/:id` | Get user |
| 17 | PATCH | `/api/v1/users/:id` | Update user |
| 18 | DELETE | `/api/v1/users/:id` | Delete user |

#### PROPERTIES (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 19 | GET | `/api/v1/properties` | List properties |
| 20 | GET | `/api/v1/properties/:id` | Get property |
| 21 | POST | `/api/v1/properties` | Create property |
| 22 | PUT | `/api/v1/properties/:id` | Update property |
| 23 | DELETE | `/api/v1/properties/:id` | Delete property |

#### ROOMS (7 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 24 | GET | `/api/v1/rooms` | List rooms |
| 25 | GET | `/api/v1/rooms/available` | Available rooms for dates |
| 26 | GET | `/api/v1/rooms/:id` | Get room |
| 27 | POST | `/api/v1/rooms` | Create room |
| 28 | PATCH | `/api/v1/rooms/:id` | Update room |
| 29 | PATCH | `/api/v1/rooms/:id/status` | Update room status |
| 30 | DELETE | `/api/v1/rooms/:id` | Delete room |

#### BOOKINGS (11 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 31 | GET | `/api/v1/bookings` | List bookings |
| 32 | GET | `/api/v1/bookings/:id` | Get booking |
| 33 | GET | `/api/v1/bookings/:id/checkout-summary` | Checkout summary |
| 34 | POST | `/api/v1/bookings` | Create booking |
| 35 | PUT | `/api/v1/bookings/:id` | Update booking |
| 36 | POST | `/api/v1/bookings/:id/checkin` | Check-in |
| 37 | POST | `/api/v1/bookings/:id/checkout` | Check-out |
| 38 | POST | `/api/v1/bookings/:id/folio/charges` | Add folio charge |
| 39 | GET | `/api/v1/bookings/:id/folio` | Get folio |
| 40 | POST | `/api/v1/bookings/:id/folio/finalize` | Finalize folio |
| 41 | DELETE | `/api/v1/bookings/:id` | Cancel booking |

#### GUESTS (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 42 | GET | `/api/v1/guests` | List guests |
| 43 | GET | `/api/v1/guests/:id` | Get guest |
| 44 | POST | `/api/v1/guests` | Create guest |
| 45 | PUT | `/api/v1/guests/:id` | Update guest |
| 46 | DELETE | `/api/v1/guests/:id` | Delete guest |

#### CHANNELS (7 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 47 | GET | `/api/v1/channels` | List channels |
| 48 | GET | `/api/v1/channels/:id` | Get channel |
| 49 | POST | `/api/v1/channels` | Create channel |
| 50 | PATCH | `/api/v1/channels/:id` | Update channel |
| 51 | PATCH | `/api/v1/channels/:id/toggle-active` | Toggle active |
| 52 | POST | `/api/v1/channels/:id/sync` | Sync channel |
| 53 | DELETE | `/api/v1/channels/:id` | Delete channel |

#### HR (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 54 | GET | `/api/v1/hr` | List employees |
| 55 | GET | `/api/v1/hr/:id` | Get employee |
| 56 | POST | `/api/v1/hr` | Create employee |
| 57 | PATCH | `/api/v1/hr/:id` | Update employee |
| 58 | DELETE | `/api/v1/hr/:id` | Delete employee |

#### RESTAURANT (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 59 | GET | `/api/v1/restaurant` | List restaurants |
| 60 | GET | `/api/v1/restaurant/:id` | Get restaurant |
| 61 | POST | `/api/v1/restaurant` | Create restaurant |
| 62 | PATCH | `/api/v1/restaurant/:id` | Update restaurant |
| 63 | DELETE | `/api/v1/restaurant/:id` | Delete restaurant |

#### REVIEWS (9 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 64 | GET | `/api/v1/reviews` | List reviews |
| 65 | GET | `/api/v1/reviews/stats` | Review statistics |
| 66 | GET | `/api/v1/reviews/qr/:code` | Get by QR code |
| 67 | GET | `/api/v1/reviews/booking/:bookingId` | Get by booking |
| 68 | GET | `/api/v1/reviews/:id` | Get review |
| 69 | POST | `/api/v1/reviews` | Create review |
| 70 | POST | `/api/v1/reviews/qr/generate` | Generate QR |
| 71 | PATCH | `/api/v1/reviews/:id` | Update review |
| 72 | DELETE | `/api/v1/reviews/:id` | Delete review |

#### REPORTS (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 73 | POST | `/api/v1/reports/export` | Export data |
| 74 | POST | `/api/v1/reports/export/download` | Export & download |
| 75 | GET | `/api/v1/reports/revenue` | Revenue report |
| 76 | GET | `/api/v1/reports/occupancy` | Occupancy report |

#### SUBSCRIPTIONS (6 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 77 | POST | `/api/v1/subscriptions` | Create subscription |
| 78 | GET | `/api/v1/subscriptions` | List subscriptions |
| 79 | GET | `/api/v1/subscriptions/:id` | Get subscription |
| 80 | GET | `/api/v1/subscriptions/tenant/:tenantId` | Get by tenant |
| 81 | PATCH | `/api/v1/subscriptions/:id` | Update subscription |
| 82 | DELETE | `/api/v1/subscriptions/:id` | Delete subscription |

#### INVOICES (6 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 83 | POST | `/api/v1/invoices` | Create invoice |
| 84 | GET | `/api/v1/invoices` | List invoices |
| 85 | GET | `/api/v1/invoices/:id` | Get invoice |
| 86 | GET | `/api/v1/invoices/tenant/:tenantId` | Get by tenant |
| 87 | PATCH | `/api/v1/invoices/:id` | Update invoice |
| 88 | DELETE | `/api/v1/invoices/:id` | Delete invoice |

#### PAYMENTS (8 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 89 | POST | `/api/v1/payments` | Create payment |
| 90 | GET | `/api/v1/payments` | List payments |
| 91 | GET | `/api/v1/payments/:id` | Get payment |
| 92 | GET | `/api/v1/payments/invoice/:invoiceId` | Get by invoice |
| 93 | POST | `/api/v1/payments/:id/approve` | Approve payment |
| 94 | POST | `/api/v1/payments/:id/reject` | Reject payment |
| 95 | PATCH | `/api/v1/payments/:id` | Update payment |
| 96 | DELETE | `/api/v1/payments/:id` | Delete payment |

#### PROMPTPAY (7 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 97 | POST | `/api/v1/payments/promptpay/generate-qr` | Generate QR |
| 98 | GET | `/api/v1/payments/promptpay/status/:ref` | Payment status |
| 99 | POST | `/api/v1/payments/promptpay/webhook` | Payment webhook |
| 100 | POST | `/api/v1/payments/promptpay/verify` | Verify payment |
| 101 | GET | `/api/v1/payments/promptpay/transactions` | Transaction history |
| 102 | GET | `/api/v1/payments/promptpay/reconciliation/:date` | Daily reconciliation |
| 103 | POST | `/api/v1/payments/promptpay/refund` | Process refund |

#### PLANS (6 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 104 | GET | `/api/v1/plans` | List plans |
| 105 | GET | `/api/v1/plans/:id` | Get plan |
| 106 | GET | `/api/v1/plans/code/:code` | Get by code |
| 107 | POST | `/api/v1/plans` | Create plan |
| 108 | PATCH | `/api/v1/plans/:id` | Update plan |
| 109 | DELETE | `/api/v1/plans/:id` | Delete plan |

#### ADMIN PANEL (3 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 110 | GET | `/api/v1/admin-panel/dashboard` | Admin dashboard |
| 111 | GET | `/api/v1/admin-panel/hotels` | All hotels |
| 112 | GET | `/api/v1/admin-panel/pending-payments` | Pending payments |

#### ADMIN HOTELS (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 113 | GET | `/api/v1/admin/hotels` | List hotels |
| 114 | GET | `/api/v1/admin/hotels/summary` | Hotels summary |
| 115 | GET | `/api/v1/admin/hotels/:id` | Hotel detail |
| 116 | PATCH | `/api/v1/admin/hotels/:id/status` | Update status |
| 117 | POST | `/api/v1/admin/hotels/:id/notify` | Notify owner |

#### ADMIN SUBSCRIPTIONS (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 118 | GET | `/api/v1/admin/subscriptions` | List subscriptions |
| 119 | GET | `/api/v1/admin/subscriptions/summary` | Summary |
| 120 | GET | `/api/v1/admin/subscriptions/:id` | Get detail |
| 121 | PATCH | `/api/v1/admin/subscriptions/:id/status` | Update status |

#### TENANTS (12 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 122 | POST | `/api/v1/tenants/hotels` | Create hotel |
| 123 | GET | `/api/v1/tenants/hotels` | List hotels |
| 124 | GET | `/api/v1/tenants/hotels/:id` | Hotel detail |
| 125 | POST | `/api/v1/tenants/create-company` | Create company |
| 126 | GET | `/api/v1/tenants/my-companies` | My companies |
| 127 | POST | `/api/v1/tenants/switch` | Switch tenant |
| 128 | POST | `/api/v1/tenants/invite` | Invite user |
| 129 | POST | `/api/v1/tenants` | Create tenant |
| 130 | GET | `/api/v1/tenants` | List tenants |
| 131 | GET | `/api/v1/tenants/:id/detail` | Tenant detail |
| 132 | PATCH | `/api/v1/tenants/:id` | Update tenant |
| 133 | DELETE | `/api/v1/tenants/:id` | Delete tenant |

#### NOTIFICATIONS (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 134 | GET | `/api/v1/notifications` | List notifications |
| 135 | PATCH | `/api/v1/notifications/:id/read` | Mark read |
| 136 | PATCH | `/api/v1/notifications/read-all` | Mark all read |
| 137 | DELETE | `/api/v1/notifications/:id` | Delete notification |

#### EMAIL (12 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 138 | POST | `/api/v1/notifications/email/send` | Send email |
| 139 | POST | `/api/v1/notifications/email/send-bulk` | Bulk email |
| 140 | GET | `/api/v1/notifications/email/history` | Email history |
| 141 | GET | `/api/v1/notifications/email/templates` | Templates |
| 142 | POST | `/api/v1/notifications/email/resend` | Resend email |
| 143 | POST | `/api/v1/notifications/email/test` | Test email |
| 144 | GET | `/api/v1/notifications/email/preferences` | Get prefs |
| 145 | GET | `/api/v1/notifications/email/preferences/:email` | Get prefs (admin) |
| 146 | PUT | `/api/v1/notifications/email/preferences` | Update prefs |
| 147 | PUT | `/api/v1/notifications/email/preferences/:email` | Update prefs (admin) |
| 148 | POST | `/api/v1/notifications/email/unsubscribe` | Unsubscribe |
| 149 | POST | `/api/v1/notifications/email/resubscribe` | Resubscribe |

#### LINE NOTIFY (11 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 150 | GET | `/api/v1/line-notify/connect` | Auth URL |
| 151 | GET | `/api/v1/line-notify/callback` | OAuth callback |
| 152 | GET | `/api/v1/line-notify/status` | Connection status |
| 153 | POST | `/api/v1/line-notify/preferences` | Update prefs |
| 154 | GET | `/api/v1/line-notify/event-types` | Event types |
| 155 | DELETE | `/api/v1/line-notify/disconnect` | Disconnect |
| 156 | POST | `/api/v1/line-notify/test` | Test notification |
| 157 | POST | `/api/v1/line-notify/send` | Send notification |
| 158 | GET | `/api/v1/line-notify/users` | Connected users |
| 159 | GET | `/api/v1/line-notify/success` | Success page |
| 160 | GET | `/api/v1/line-notify/error` | Error page |

#### AUDIT LOGS (3 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 161 | GET | `/api/v1/audit-logs` | List audit logs |
| 162 | GET | `/api/v1/audit-logs/export` | Export CSV |
| 163 | GET | `/api/v1/audit-logs/:id` | Get log detail |

#### ANALYTICS (3 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 164 | POST | `/api/v1/analytics/event` | Track event |
| 165 | GET | `/api/v1/analytics/summary` | Analytics summary |
| 166 | GET | `/api/v1/analytics/feature-flag/:name` | Feature flag |

#### ONBOARDING (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 167 | POST | `/onboarding/register` | Register trial |
| 168 | GET | `/onboarding/tenant/:tenantId/trial-status` | Trial status |
| 169 | GET | `/onboarding/progress` | Onboarding progress |
| 170 | PATCH | `/onboarding/step/:id` | Update step |

#### CONTACT (4 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 171 | POST | `/contact/demo` | Demo request |
| 172 | POST | `/contact/message` | Contact message |
| 173 | GET | `/contact/demos` | List demos |
| 174 | GET | `/contact/messages` | List messages |

#### HEALTH CHECK (2 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 175 | GET | `/api/v1/health` | Liveness check |
| 176 | GET | `/api/v1/health/ready` | Readiness check |

#### OTHER (5 endpoints)
| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 177 | GET | `/subscription/renewal-status` | Renewal status |
| 178 | POST | `/seeder/run` | Run seeder |
| 179 | GET | `/loyalty/points` | Loyalty points |
| 180 | POST | `/referral/invite` | Invite referral |
| 181 | GET | `/promotions/active` | Active promotions |
| 182 | POST | `/promotions/apply-coupon` | Apply coupon |

---

### Endpoints ที่ต้องสร้างใหม่ (สำหรับ Redesign)

| # | Method | Endpoint | Description | Priority |
|---|--------|----------|-------------|----------|
| NEW-1 | GET | `/api/v1/dashboard/today-actions` | Today's action items (check-ins due, check-outs due, rooms to clean, payments pending) | **HIGH** |
| NEW-2 | GET | `/api/v1/dashboard/metrics` | Aggregated KPIs (occupancy, ADR, RevPAR, revenue, trends) | **HIGH** |
| NEW-3 | GET | `/api/v1/dashboard/timeline` | Today's timeline (sorted arrivals/departures by time) | **HIGH** |
| NEW-4 | WS | `/ws/dashboard/activity-feed` | Real-time activity feed via WebSocket | **MEDIUM** |
| NEW-5 | GET | `/api/v1/dashboard/room-heatmap` | Room status summary grouped by floor | **MEDIUM** |
| NEW-6 | GET | `/api/v1/search/global?q=` | Global search across guests, bookings, rooms | **HIGH** |
| NEW-7 | GET | `/api/v1/housekeeping/tasks` | Housekeeping task board (pending/in-progress/done) | **MEDIUM** |
| NEW-8 | PATCH | `/api/v1/housekeeping/tasks/:id/status` | Update housekeeping task status | **MEDIUM** |

**Total: 182 existing endpoints + 8 new endpoints = 190 endpoints**

---

### Frontend Pages Summary (68+ pages)

#### Authentication (5 pages)
- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/billing`

#### Dashboard Core (3 pages)
- `/dashboard`, `/dashboard/getting-started`, `/dashboard/setup`

#### Hotels/Properties (12+ pages)
- `/dashboard/hotels`, `/dashboard/hotels/[id]`
- `/dashboard/hotels/[id]/rooms`, `/dashboard/hotels/[id]/hr/*`, `/dashboard/hotels/[id]/restaurant/*`

#### Bookings & Guests (6 pages)
- `/dashboard/bookings`, `/dashboard/bookings/[id]`, `/dashboard/bookings/[id]/edit`, `/dashboard/bookings/[id]/checkout`
- `/dashboard/guests`, `/dashboard/guests/[id]`

#### Rooms & Housekeeping (4 pages)
- `/dashboard/rooms`, `/dashboard/rooms/housekeeping`, `/dashboard/rooms/maintenance`
- `/dashboard/housekeeping`

#### Restaurant (4 pages)
- `/dashboard/restaurant`, `/dashboard/restaurant/menu`, `/dashboard/restaurant/kitchen`, `/dashboard/restaurant/inventory`

#### HR (5 pages)
- `/dashboard/hr`, `/dashboard/hr/employees`, `/dashboard/hr/attendance`, `/dashboard/hr/leave`, `/dashboard/hr/payroll`

#### Reports (3 pages)
- `/dashboard/reports`, `/dashboard/reports/occupancy`, `/dashboard/reports/revenue`, `/dashboard/reports/custom`

#### Settings (6 pages)
- `/dashboard/settings`, `/dashboard/settings/security`, `/dashboard/settings/notifications`
- `/dashboard/settings/push-notifications`, `/dashboard/settings/line-notify`, `/dashboard/settings/audit-logs`

#### Other Dashboard (5 pages)
- `/dashboard/channels`, `/dashboard/front-desk`, `/dashboard/reviews`, `/dashboard/payments`, `/dashboard/payments/promptpay`, `/dashboard/subscription`

#### Admin (6 pages)
- `/admin`, `/admin/login`, `/admin/hotels`, `/admin/admins`, `/admin/plans`, `/admin/subscriptions`, `/admin/invoices`, `/admin/features`

#### Guest Portal (3 pages)
- `/guest/[code]`, `/guest/register`, `/review/[code]`

#### Marketing (3 pages)
- `/onboarding`, `/pricing`, `/contact`

#### Restaurant Guest (1 page)
- `/restaurant/order/[tableId]`

---

*End of Report*
