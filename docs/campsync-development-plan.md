# CampSync — แผนพัฒนาระบบจัดการลานกางแคมป์

> ระบบ SaaS จัดการลานกางแคมป์ (Campground Management) แยกออกจากระบบโรงแรม StaySync
> Stack เดียวกัน: **NestJS 10 + Prisma (MySQL)** (backend) / **Next.js 14 App Router** (frontend)
> เอกสารฉบับนี้เป็น blueprint สำหรับเริ่มพัฒนา — เน้น Map แบบ **2D Interactive ก่อน** แล้วต่อยอดเป็น phase

**สถานะ:** Draft v1 · 2026-06-12
**เจ้าของ:** Todsaporn (Jack)

---

## 1. เป้าหมายและขอบเขต (Goal & Scope)

CampSync คือระบบจัดการลานกางแคมป์แบบ multi-tenant เจ้าของลานสามารถ:

- จัดการลาน/โซน/จุดกางเต็นท์ (Pitch) และสถานะของแต่ละจุด
- เปิดให้ลูกค้าจองออนไลน์ผ่านแผนผังลานแบบ interactive
- ขาย add-on (เช่าอุปกรณ์) ผูกกับการจอง
- รับชำระเงิน (PromptPay/บัตร) ออกใบเสร็จ
- ดูรายงาน occupancy / รายได้ / รีวิว

**หลักการออกแบบ:** แยกเป็น service ใหม่ทั้ง repo (`owner-camp-services-api` + `owner-camp-services`) แต่ reuse pattern และ shared module จาก StaySync ให้มากที่สุด (auth, payment, notification, tenant)

### หน่วยที่ขาย (ความต่างหลักจากโรงแรม)

| โรงแรม | แคมป์ | หมายเหตุ |
|---|---|---|
| Property | **Campground** | ลาน/สาขา |
| Room Type | **Zone Type** | วิวภูเขา / ริมน้ำ / ลานหญ้า / RV / Glamping |
| Room | **Pitch (Site)** | จุดกางเต็นท์รายจุด มีพิกัดบนแผนผัง |
| Room status | **Pitch status** | available / occupied / cleaning / maintenance / closed |
| Booking | **Reservation** | จองรายคืน เลือกจุดหรือโซน |
| Housekeeping | **Site Prep** | เก็บกวาด/เช็คความพร้อมจุด |
| Minibar | **Add-on Rental** | เช่าเต็นท์ ถุงนอน เตา ฟืน ฯลฯ |

---

## 2. สถาปัตยกรรมระบบ (Architecture)

```
┌─────────────────────────────────────────────────────────┐
│                  owner-camp-services (FE)               │
│            Next.js 14 · React 18 · Zustand              │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐   │
│   │ Booking Flow │  │ 2D Map View  │  │ Owner Admin │   │
│   └──────────────┘  └──────────────┘  └─────────────┘   │
└───────────────────────────┬─────────────────────────────┘
                            │ REST /api/v1  (JWT)
┌───────────────────────────┴─────────────────────────────┐
│              owner-camp-services-api (BE)               │
│                   NestJS 10 · Prisma                    │
│  Core: Campground · Zone · Pitch · Reservation · Addon  │
│  Support: Auth · Payment · Notification · Tenant · ...   │
└──────┬───────────────┬──────────────┬───────────────────┘
       │               │              │
   ┌───┴───┐      ┌────┴────┐    ┌────┴────┐
   │ MySQL │      │  Redis  │    │  Bull   │
   │Prisma │      │ (cache) │    │ (queue) │
   └───────┘      └─────────┘    └─────────┘
```

**Infra ใช้ร่วม StaySync ได้:** Redis, Bull, Socket.IO, Mailer, Firebase, PromptPay gateway

---

## 3. Data Model (Prisma — ร่างคร่าว)

> ร่างไว้ให้เห็นความสัมพันธ์ ปรับ field ตอนลงมือจริงได้

```prisma
model Campground {
  id          String   @id @default(cuid())
  tenantId    String   // multi-tenant isolation
  name        String
  description String?  @db.Text
  address     String?
  latitude    Float?
  longitude   Float?
  mapImageUrl String?  // รูปแปลนพื้นที่ (background ของ 2D map)
  mapWidth    Int?     // ขนาด canvas อ้างอิงพิกัด marker
  mapHeight   Int?
  status      CampgroundStatus @default(ACTIVE)
  zones       Zone[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Zone {
  id            String   @id @default(cuid())
  campgroundId  String
  name          String
  type          ZoneType // MOUNTAIN_VIEW | RIVERSIDE | LAWN | RV | GLAMPING
  basePrice     Decimal  @db.Decimal(10,2)
  maxGuests     Int
  maxTents      Int      @default(1)
  allowVehicle  Boolean  @default(false)
  allowPet      Boolean  @default(false)
  pitches       Pitch[]
  campground    Campground @relation(fields: [campgroundId], references: [id])
}

model Pitch {
  id          String   @id @default(cuid())
  zoneId      String
  code        String   // เช่น A1, B2
  status      PitchStatus @default(AVAILABLE)
  posX        Float    // พิกัดบนแผนผัง 2D (0..mapWidth)
  posY        Float    // พิกัดบนแผนผัง 2D (0..mapHeight)
  sizeSqm     Float?
  reservations ReservationPitch[]
  zone        Zone     @relation(fields: [zoneId], references: [id])
  @@unique([zoneId, code])
}

model Reservation {
  id              String   @id @default(cuid())
  tenantId        String
  campgroundId    String
  guestId         String
  scheduledCheckIn  DateTime
  scheduledCheckOut DateTime
  numGuests       Int
  numTents        Int      @default(1)
  numVehicles     Int      @default(0)
  hasPet          Boolean  @default(false)
  status          ReservationStatus @default(PENDING)
  totalAmount     Decimal  @db.Decimal(10,2)
  pitches         ReservationPitch[]
  addons          ReservationAddon[]
  payment         Payment?
  createdAt       DateTime @default(now())
}

model ReservationPitch {
  id            String @id @default(cuid())
  reservationId String
  pitchId       String
  pricePerNight Decimal @db.Decimal(10,2)
  reservation   Reservation @relation(fields: [reservationId], references: [id])
  pitch         Pitch       @relation(fields: [pitchId], references: [id])
}

model Addon {
  id          String  @id @default(cuid())
  tenantId    String
  name        String  // เต็นท์ 3 คน, ถุงนอน, เตาย่าง, ฟืน
  category    AddonCategory
  pricePerUnit Decimal @db.Decimal(10,2)
  stockQty    Int     // จำนวนคงเหลือ
  reservations ReservationAddon[]
}

model ReservationAddon {
  id            String @id @default(cuid())
  reservationId String
  addonId       String
  qty           Int
  priceSnapshot Decimal @db.Decimal(10,2)
}

// enums
enum CampgroundStatus { ACTIVE INACTIVE }
enum ZoneType { MOUNTAIN_VIEW RIVERSIDE LAWN RV GLAMPING }
enum PitchStatus { AVAILABLE OCCUPIED CLEANING MAINTENANCE CLOSED }
enum ReservationStatus { PENDING CONFIRMED CHECKED_IN CHECKED_OUT CANCELLED NO_SHOW }
enum AddonCategory { TENT SLEEPING GEAR COOKING FIREWOOD ELECTRIC OTHER }
```

---

## 4. โมดูล Backend (NestJS)

ทุกโมดูลทำตาม pattern เดิม: `controller / service / module / dto/ / entities/`

### Core modules (ต้องเขียนใหม่)

| Module | หน้าที่ |
|---|---|
| `campgrounds` | CRUD ลาน + อัพโหลดรูปแปลน + ตั้งค่า map canvas |
| `zones` | CRUD โซน + กำหนดราคา/ความจุ |
| `pitches` | CRUD จุดกางเต็นท์ + พิกัด + สถานะ + availability calc |
| `reservations` | จอง/ยืนยัน/check-in/out/ยกเลิก + กันจองซ้อน + buffer ทำความสะอาด |
| `addons` | จัดการอุปกรณ์เช่า + stock + ผูกกับ reservation |
| `pricing` | คำนวณราคา: base + season + per-guest + ค่าธรรมเนียม (รถ/สัตว์เลี้ยง) |
| `site-prep` | งานเตรียมจุด (เทียบ housekeeping) lifecycle: create→assign→complete |

### Support modules (พอร์ตจาก StaySync — แก้น้อย)

`auth` (JWT + 2FA), `users`, `guests`, `tenants`, `payments`, `promptpay`, `invoices`, `notifications`, `push-notifications`, `email`, `reviews`, `loyalty`, `analytics`, `reports`, `audit-log`, `seeder`

> ประเมินงาน: support modules ~70% reuse ได้, core modules เขียนใหม่แต่ลอก pattern booking/room เดิม

---

## 5. โมดูล Frontend (Next.js)

```
app/
├── (owner)/dashboard/      # แดชบอร์ดเจ้าของลาน
├── (owner)/campgrounds/    # จัดการลาน + map editor
├── (owner)/zones/          # จัดการโซน
├── (owner)/reservations/   # รายการจอง + ปฏิทิน
├── (owner)/addons/         # คลังอุปกรณ์เช่า
├── (guest)/explore/        # ลูกค้าเลือกลาน
├── (guest)/[campId]/map/   # *** 2D Interactive Map เลือกจุด ***
├── (guest)/booking/        # flow การจอง
└── (auth)/login,register/

components/
├── Map/                    # MapCanvas, PitchMarker, MapEditor, ZoneLayer
├── Reservation/
├── Zone/ Pitch/ Addon/
└── UI/                     # custom components (ตามกฎ ไม่ใช้ shadcn)

lib/
├── stores/   # Zustand: useMapStore, useReservationStore, useAddonStore
├── hooks/    # useAvailability, usePitchSelection
└── types/
```

ใช้กฎเดิม: full-width ทุกหน้า, named interface สำหรับ props, ไม่ใช้ `React.FC`, validate ด้วย Zod, state ผ่าน Zustand

---

## 6. 2D Interactive Map — สเปกละเอียด (Phase 1 หลัก)

### แนวคิด

อัพโหลดรูปแปลนพื้นที่เป็น **background image** แล้ววาง **marker จุดกางเต็นท์** ทับด้วยพิกัด (X, Y) ที่เก็บใน `Pitch.posX / posY` ลูกค้าเห็นแผนผัง คลิกเลือกจุดที่ว่างได้ทันที

### โครงสร้าง 2 โหมด

**A) Owner Map Editor** (เจ้าของลานตั้งค่า)
- อัพโหลดรูปแปลน → เก็บ `mapImageUrl`, `mapWidth`, `mapHeight`
- ลาก-วาง marker เพื่อสร้าง/ย้ายจุด (drag & drop ด้วย React DnD ที่มีอยู่แล้ว)
- กำหนด code, โซน, ขนาด ต่อจุด
- บันทึกพิกัดกลับ backend

**B) Guest Map View** (ลูกค้าจอง)
- โหลดรูปแปลน + render marker ตามสถานะ (สี: เขียว=ว่าง / แดง=เต็ม / เทา=ปิด)
- คลิก marker → popup ข้อมูลจุด + ราคา → เลือก
- filter ตามวันที่ → query availability → อัพเดทสีแบบ real-time

### เทคนิคที่ใช้ (เริ่มเร็ว ปลอดภัย)

- **SVG หรือ `<canvas>`** วาง marker — เริ่มด้วย SVG (debug ง่าย, คลิกอีเวนต์ตรงไปตรงมา)
- รูปแปลนเป็น `<image>` ชั้นล่าง, marker เป็น `<circle>/<g>` ชั้นบน
- พิกัดเก็บแบบ normalized (0..1) หรืออิง mapWidth/Height — แนะนำ normalized เพื่อ responsive
- zoom/pan ด้วย transform (รองรับลานใหญ่)
- **ยังไม่แตะ Three.js / 3D ใน phase นี้** — เก็บไว้ phase หลัง

### API ที่ต้องมีรองรับ map

```
GET  /api/v1/campgrounds/:id/map          # รูปแปลน + ขนาด canvas
GET  /api/v1/campgrounds/:id/pitches      # จุดทั้งหมด + พิกัด + สถานะ
GET  /api/v1/campgrounds/:id/availability?checkIn=&checkOut=
PATCH /api/v1/pitches/:id/position        # owner ย้าย marker
POST /api/v1/campgrounds/:id/map-image    # อัพโหลดรูปแปลน
```

---

## 7. Roadmap แบ่ง Phase

### Phase 0 — Setup (สัปดาห์ 1)
- สร้าง 2 repo ใหม่จาก template StaySync
- ตั้งค่า Prisma schema (ตาม §3), migration แรก, seeder ตัวอย่าง
- พอร์ต auth + tenant + user มาให้ login ได้

### Phase 1 — Core MVP + 2D Map (สัปดาห์ 2–5) ⭐
- โมดูล campgrounds / zones / pitches (CRUD + status)
- โมดูล reservations (จอง + กันซ้อน + check-in/out + buffer)
- **2D Map: Owner editor + Guest view** (ตาม §6)
- pricing engine เบื้องต้น (base + per-guest)
- payment + promptpay (พอร์ต)
- รายงาน occupancy พื้นฐาน

### Phase 2 — ขยายฟีเจอร์ (สัปดาห์ 6–8)
- Add-on rental + stock management
- season pricing + ค่าธรรมเนียม (รถ/สัตว์เลี้ยง)
- notification (LINE/Push), review, loyalty (พอร์ต)
- Weather integration (พยากรณ์อากาศ + นโยบายฝนตก)
- รายงาน/analytics เต็ม

### Phase 3 — ยกระดับ Map (สัปดาห์ 9+)
- **2.5D Isometric** ด้วย react-three-fiber (เต็นท์/ต้นไม้มีมิติ)
- **AI-assisted layout:** อัพแปลน → AI detect โซน/เดาตำแหน่งจุด → เจ้าของลากปรับใน editor
- (วิจัยต่อ) AI gen 3D scene เต็มรูปแบบ — R&D แยก ไม่ block production

---

## 8. ความเสี่ยง & ข้อควรระวัง

- **กันจองซ้อน (double booking):** ใช้ transaction + lock ตอน confirm — reuse logic availability + buffer จาก StaySync
- **Multi-tenant isolation:** ทุก query ต้อง filter `tenantId` (Prisma middleware)
- **รูปแปลนสเกลไม่ตรง:** ใช้ normalized coordinate กัน marker เพี้ยนเมื่อเปลี่ยนขนาดจอ
- **AI 3D (phase 3):** อย่าสัญญาลูกค้าว่า "อัพแล้วเสร็จ" — ต้องมี human review เสมอ
- **Test coverage 80%** ตามกฎโปรเจกต์ — เขียน test คู่ทุก core module

---

## 9. ขั้นถัดไป (Next Actions)

1. ยืนยัน data model §3 (เพิ่ม/ตัด field)
2. บ่าวสร้าง repo skeleton + Prisma schema จริง + migration ได้เลยถ้านายท่านโอเค
3. เริ่ม Phase 0 → Phase 1

> อยากให้บ่าวลงมือ scaffold repo backend (`owner-camp-services-api`) ตาม schema นี้เลยไหมคะ หรือปรับ blueprint ก่อน
