# Inventory Lot / QR / QC / Expiry — Backend Development Plan

**Project:** Owner Hotel Services API (StaySync)
**Module scope:** `src/modules/inventory/*`, `src/modules/cost-accounting/*`, `src/modules/notifications/*`
**Target release:** 2026-Q2
**Owner:** Backend Team (NestJS / Prisma / MySQL)
**Created:** 2026-04-18
**Status:** Draft — ready for team review

---

## 1. บริบทและปัญหาปัจจุบัน (Context & Problem Statement)

ระบบ inventory ของ StaySync มี flow หลัก (PO → GR → StockMovement → WarehouseStock) ครบถ้วนใน backend แต่ยังขาดความสามารถระดับ ERP สำหรับโรงแรม / ร้านอาหารที่ต้องจัดการสินค้ามีอายุการเก็บ (perishable) และต้องการ traceability

### 1.1 สิ่งที่มีอยู่แล้ว (Existing capability)

- โมดูล `purchase-orders` — PO lifecycle ครบถ้วน พร้อม discount mode และ calculation breakdown
- โมดูล `goods-receives` — service method `create()` / `inspect()` ออกเลข GR อัตโนมัติ เชื่อมกลับ PO อัปเดต `receivedQty` และ `status` แล้วสร้าง `StockMovement` + อัปเดต `WarehouseStock` weighted average cost (คอมพลีท transaction)
- โมดูล `stock-movements` — รองรับ 8 ประเภท (GOODS_RECEIVE / GOODS_ISSUE / TRANSFER_IN/OUT / ADJUSTMENT_IN/OUT / RETURN_SUPPLIER / WASTE) และมี auto-counter transfer
- โมดูล `stock-counts` — Physical inventory (full / partial / cycle)
- `InventoryItem` มี field `isPerishable` + `defaultShelfLifeDays` + `costMethod` (WEIGHTED_AVG / FIFO / LIFO enum)
- `StockMovement` และ `GoodsReceiveItem` เก็บ `batchNumber` + `expiryDate` (string/date) แต่**ไม่ได้เป็น entity แยก**
- EventEmitter ส่ง `StockMovementCreatedEvent` เข้า cost-accounting อัตโนมัติ

### 1.2 Gap ที่ต้องปิด (Gap analysis)

| # | Gap | Impact |
|---|-----|--------|
| G1 | ไม่มี `InventoryLot` entity — balance เก็บเป็น aggregate ต่อ (warehouse, item) เท่านั้น | Trace lot ไม่ได้, FEFO ไม่บังคับ, คำนวณมูลค่าสินค้าใกล้หมดอายุไม่ได้ |
| G2 | `GoodsIssue` ไม่ pick lot ตาม FEFO/FIFO | Lot เก่าค้างสต็อก หมดอายุก่อนถูกใช้ → waste cost สูง |
| G3 | ไม่มี QR code generator (by-item / by-lot) | พนักงานต้องพิมพ์ label ผ่านระบบอื่น, scan รับ–เบิกไม่สะดวก |
| G4 | QC มีแค่ flag `INSPECTING` + `rejectedQty` ไม่มี checklist / photo evidence / per-lot quarantine | ควบคุมคุณภาพ supplier ไม่ได้, ไม่มีหลักฐานกรณีมีข้อโต้แย้ง |
| G5 | ไม่มี cron แจ้งเตือน near-expiry หรือ auto-waste expired | ต้นทุน waste มาทราบทีหลัง, ไม่มีการแจ้งเตือนล่วงหน้า |
| G6 | `StockMovement.id` ใช้ `Math.random()` UUID ไม่ปลอดภัย | ID อาจซ้ำ (low probability แต่ไม่ควรมี), เสี่ยง timing attack |
| G7 | ไม่มี row-level lock ตอนหัก stock | Race condition ถ้า 2 transactions หัก stock พร้อมกัน |

---

## 2. เป้าหมายและขอบเขต (Goals & Scope)

### 2.1 Goals

1. เพิ่ม lot-level traceability ตั้งแต่รับเข้าจนเบิกออก
2. รองรับ QR code auto-generation ระดับ item และระดับ lot พร้อม endpoint resolve สำหรับ mobile scanner
3. ยกระดับ QC จากการ reject อย่างเดียวเป็น checklist + photo + supplier quality report
4. แจ้งเตือน / auto-handle สินค้าใกล้หมดอายุและหมดอายุ เชื่อมเข้า cost-accounting
5. ไม่ break flow เดิมที่ frontend ใช้อยู่ — endpoint เก่าต้องทำงานได้ต่อ (backward compatible)

### 2.2 Non-goals

- ไม่ทำ serial-number tracking (asset-level) ในรอบนี้ → แยก plan ต่างหาก
- ไม่ทำ integration กับ label printer รุ่นเฉพาะ (Zebra ZPL) → ทำเฉพาะ PDF label sheet
- ไม่ migrate historical data ของ `StockMovement.batchNumber` ไป `InventoryLot` แบบ mass (เก็บไว้เป็น legacy field ต่อไป ใช้ lotId แทนเมื่อสร้างใหม่)

---

## 3. Architecture Decisions

### 3.1 Lot as first-class entity

สร้าง `InventoryLot` แยกจาก `WarehouseStock` เพื่อ:
- เก็บ remainingQty ต่อ lot (ต่างจาก initialQty เมื่อเบิกไปแล้ว)
- Index ตาม `expiryDate` เพื่อ query FEFO เร็ว
- Reference กลับไปยัง `GoodsReceiveItem` เพื่อ trace ถึง supplier และ unit cost เดิม

`WarehouseStock` จะเปลี่ยนเป็น **denormalized summary** (quantity = SUM(InventoryLot.remainingQty)) เพื่อให้ query balance เร็วโดยไม่ต้อง join lot — update ผ่าน trigger ใน service layer (ไม่ใช้ DB trigger)

### 3.2 QR payload format

QR จะเก็บ **signed JSON** (HMAC-SHA256 short signature) ไม่ใช่ plain URL — กันปลอม QR ข้ามโรงแรม

```json
{
  "v": 1,
  "t": "lot",                      // "item" | "lot"
  "tid": "tenant-uuid",
  "iid": "item-uuid",
  "lid": "lot-uuid",               // omit for type=item
  "sku": "FLOUR-1KG",
  "lot": "LOT-202604-0001",
  "exp": "2026-06-15",
  "sig": "a1b2c3d4..."             // first 16 chars of HMAC
}
```

HMAC key เก็บใน env var `INVENTORY_QR_SECRET` (min 32 bytes) — validate ทุกครั้งที่ resolve

### 3.3 FEFO dispatch

- เปลี่ยน `StockMovement` outbound types ให้ **ต้อง specify lotId** ถ้า item เป็น perishable
- ถ้าไม่ส่ง lotId มา service จะเลือก lot อัตโนมัติด้วย `ORDER BY expiryDate ASC NULLS LAST, receivedDate ASC`
- Outbound quantity มากกว่า lot เดียว — split เป็นหลาย StockMovement records (one per lot consumed)

### 3.4 Concurrency

- ใช้ `SELECT ... FOR UPDATE` ภายใน `prisma.$transaction(async (tx) => ...)` โดย execute raw `$queryRaw` lock row ใน `inventory_lots` และ `warehouse_stocks` ก่อน update
- Transaction isolation = `SERIALIZABLE` เฉพาะ method ที่หัก stock (goods issue, transfer, adjustment)

---

## 4. Prisma Schema Changes

### 4.1 New models

```prisma
enum InventoryLotStatus {
  ACTIVE        // ใช้งานได้
  QUARANTINED   // รอ QC
  EXHAUSTED     // remainingQty = 0
  EXPIRED       // เลย expiryDate
  DISPOSED      // ทำลายแล้ว (waste)
}

model InventoryLot {
  id              String             @id @default(uuid())
  tenantId        String
  itemId          String
  warehouseId     String
  lotNumber       String             // Auto: LOT-YYYYMM-NNNN
  batchNumber     String?            // เลข batch จาก supplier (ถ้ามี)
  grItemId        String?            // Link to GoodsReceiveItem
  supplierId      String?
  receivedDate    DateTime           @default(now())
  manufactureDate DateTime?
  expiryDate      DateTime?
  initialQty      Int
  remainingQty    Int
  unitCost        Decimal            @db.Decimal(10, 2)
  status          InventoryLotStatus @default(ACTIVE)
  qrPayload       String?            @db.Text  // pre-signed payload for fast lookup
  notes           String?            @db.Text
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  item            InventoryItem      @relation(fields: [itemId], references: [id])
  warehouse       Warehouse          @relation(fields: [warehouseId], references: [id])
  stockMovements  StockMovement[]

  @@unique([tenantId, lotNumber])
  @@index([tenantId, itemId, warehouseId, status])
  @@index([expiryDate])             // FEFO dispatch
  @@index([grItemId])
  @@map("inventory_lots")
}

// QC
model QCTemplate {
  id           String            @id @default(uuid())
  tenantId     String
  name         String
  appliesTo    String            // 'CATEGORY' | 'ITEM'
  categoryId   String?
  itemId       String?
  isActive     Boolean           @default(true)
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  checklistItems QCChecklistItem[]
  records        QCRecord[]

  @@index([tenantId, appliesTo])
  @@map("qc_templates")
}

model QCChecklistItem {
  id           String      @id @default(uuid())
  templateId   String
  label        String      // เช่น "สี/กลิ่นปกติ", "อุณหภูมิ ≤ 4°C"
  type         String      // 'BOOLEAN' | 'NUMERIC' | 'TEXT' | 'PHOTO'
  required     Boolean     @default(true)
  passCondition Json?      // เช่น { op: "lte", value: 4 } สำหรับ NUMERIC
  orderIndex   Int         @default(0)

  template     QCTemplate  @relation(fields: [templateId], references: [id], onDelete: Cascade)
  results      QCResult[]

  @@index([templateId])
  @@map("qc_checklist_items")
}

enum QCRecordStatus {
  PENDING
  PASSED
  PARTIAL_FAIL
  FAILED
}

model QCRecord {
  id            String          @id @default(uuid())
  tenantId      String
  templateId    String
  goodsReceiveId String?
  lotId         String?
  status        QCRecordStatus  @default(PENDING)
  inspectedBy   String
  inspectedAt   DateTime        @default(now())
  notes         String?         @db.Text
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  template      QCTemplate      @relation(fields: [templateId], references: [id])
  results       QCResult[]

  @@index([tenantId])
  @@index([goodsReceiveId])
  @@index([lotId])
  @@map("qc_records")
}

model QCResult {
  id                String          @id @default(uuid())
  recordId          String
  checklistItemId   String
  valueBool         Boolean?
  valueNumeric      Decimal?        @db.Decimal(10, 2)
  valueText         String?         @db.Text
  photoUrls         Json?           // array of firebase storage URLs
  passed            Boolean
  createdAt         DateTime        @default(now())

  record            QCRecord        @relation(fields: [recordId], references: [id], onDelete: Cascade)
  checklistItem     QCChecklistItem @relation(fields: [checklistItemId], references: [id])

  @@index([recordId])
  @@map("qc_results")
}
```

### 4.2 Changes to existing models

```prisma
model StockMovement {
  // เพิ่ม:
  lotId     String?        // link to InventoryLot for perishable items
  lot       InventoryLot?  @relation(fields: [lotId], references: [id])

  @@index([lotId])
}

model GoodsReceiveItem {
  // เพิ่ม:
  lotId     String?        // lot ที่ถูกสร้างตอน accept
  qcRecordId String?       // link to QCRecord ถ้ามี QC
}

model InventoryItem {
  // เพิ่ม:
  requiresLotTracking Boolean @default(false)  // force lot ถ้า true (independent จาก isPerishable)
  requiresQC          Boolean @default(false)  // force QC record ก่อน accept
  defaultQCTemplateId String?
}

model Supplier {
  // เพิ่ม view field ผ่าน computed — ไม่ต้องเพิ่ม DB column
  // (คำนวณ rejection rate ใน service)
}
```

### 4.3 Migration strategy

1. สร้าง migration ใหม่ `YYYYMMDDHHMMSS_add_inventory_lots_qc.sql` — add tables, no data migration
2. รัน `npm run prisma:migrate` ใน staging ก่อน
3. สำหรับ existing perishable items — สร้าง seed script `scripts/backfill-lots-from-gr.ts` ที่อ่าน `GoodsReceiveItem` ย้อนหลัง 6 เดือน และสร้าง `InventoryLot` ประมาณ (remainingQty = initialQty - approximated-issues) → run manual + review
4. Flag environment variable `INVENTORY_LOT_ENABLED=true` เพื่อ rollout ทีละ tenant

---

## 5. API Endpoints

### 5.1 Lot management (`/api/v1/inventory/lots`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/lots` | List lots with filters (itemId, warehouseId, status, nearExpiry, expired) + pagination |
| GET | `/lots/:id` | Lot detail including movement history |
| GET | `/lots/near-expiry?days=30` | Lots expiring within N days |
| GET | `/lots/expired` | Expired lots not yet disposed |
| POST | `/lots/:id/quarantine` | Move lot → QUARANTINED (block from FEFO) |
| POST | `/lots/:id/release` | Quarantined → ACTIVE |
| POST | `/lots/:id/dispose` | Mark DISPOSED + create WASTE movement |
| GET | `/lots/:id/qr` | Generate QR code PNG/SVG for lot |
| GET | `/items/:id/lots` | All lots of specific item |

### 5.2 QR code (`/api/v1/inventory/qr`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/items/:id/qr?format=png\|svg&size=256` | Item-level QR (payload: item info) |
| GET | `/lots/:id/qr?format=png\|svg&size=256` | Lot-level QR (payload: lot info + expiry) |
| GET | `/items/:id/labels?count=12` | PDF A4 sheet of N identical item QRs |
| GET | `/lots/:id/labels?count=1` | PDF label for single lot |
| POST | `/qr/resolve` | Body: `{payload: string}` → returns item/lot detail (verifies HMAC) |

### 5.3 QC (`/api/v1/inventory/qc`)

| Method | Path | Purpose |
|---|---|---|
| GET/POST/PATCH/DELETE | `/qc/templates` | CRUD QC template |
| GET/POST/PATCH/DELETE | `/qc/templates/:id/items` | CRUD checklist items |
| GET | `/qc/records` | List QC records with filter (supplier, status, date) |
| POST | `/qc/records` | Create QC record (linked to GR or Lot) |
| GET | `/qc/records/:id` | Record detail |
| POST | `/qc/records/:id/submit` | Submit → PASSED/PARTIAL_FAIL/FAILED |
| POST | `/qc/records/:id/photos` | Upload photo for a result (multipart) |
| GET | `/qc/supplier-quality?supplierId=...` | Rejection rate / pass rate report |

### 5.4 Goods Receive (enhancement, backward compatible)

| Method | Path | Change |
|---|---|---|
| POST | `/goods-receives` | Add optional `createLots: true`, `qcTemplateId` in body |
| POST | `/goods-receives/:id/accept-lot` | Accept individual lot after QC pass |
| POST | `/goods-receives/:id/reject-lot` | Reject lot → DISPOSED + optional return to supplier |

### 5.5 Stock Movement (enhancement)

- `POST /stock-movements` body รองรับ `lotId` (optional) — ถ้าไม่ส่ง + item เป็น perishable → auto-pick FEFO
- Response include `consumedLots: Array<{lotId, qty, unitCost}>` เมื่อมีการ split

### 5.6 Dashboard / reports (`/api/v1/inventory/dashboard`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard/near-expiry-value` | Total value of lots expiring in next 30 days |
| GET | `/dashboard/expired-waste-last-month` | Waste cost attributable to expiry |
| GET | `/reports/inventory-valuation-by-lot` | CSV/JSON export |
| GET | `/reports/expiry-schedule` | Lots grouped by expiry week/month |

---

## 6. Scheduled Jobs (Bull Queue)

ใช้ BullMQ ที่มีอยู่แล้ว (`QueueName = 'inventory'`):

| Job | Schedule | Description |
|---|---|---|
| `inventory.check-near-expiry` | Daily 06:00 | Query lots ที่ expiryDate อยู่ใน 30/14/7/1 วัน → push Notification + Email + LINE Notify + FCM |
| `inventory.auto-expire-lots` | Daily 00:05 | Mark lots `expiryDate < now` → status=EXPIRED, quarantine ออกจาก FEFO |
| `inventory.auto-waste-expired` | Configurable (default OFF) | Auto create WASTE movement สำหรับ EXPIRED lots ที่ค้างเกิน X วัน |
| `inventory.qc-reminder` | Every 4 hours | GR ที่ status=INSPECTING ค้างเกิน 24 ชั่วโมง → notify |

Config ต่อ tenant ใน `tenants.settings` JSON:
```json
{
  "inventory": {
    "nearExpiryDaysBefore": [30, 14, 7, 1],
    "autoWasteExpired": false,
    "autoWasteGraceDays": 7
  }
}
```

---

## 7. Event Integration

เพิ่ม events ใน `cost-accounting/events/cost-accounting.events.ts`:

```typescript
export const INVENTORY_EVENTS = {
  LOT_CREATED: 'inventory.lot.created',
  LOT_EXPIRED: 'inventory.lot.expired',
  LOT_DISPOSED: 'inventory.lot.disposed',
  QC_FAILED: 'inventory.qc.failed',
  NEAR_EXPIRY_ALERT: 'inventory.near_expiry.alert',
};
```

Subscribers:
- `notifications/push-notifications` → ส่ง FCM ให้ manager เมื่อ QC_FAILED / NEAR_EXPIRY_ALERT
- `cost-accounting/waste-tracking` → อัตโนมัติสร้าง WasteRecord เมื่อ LOT_DISPOSED
- `audit-log` → บันทึกทุก event

---

## 8. Task Breakdown (by sprint)

### Sprint 1 (Week 1–2) — Foundation

- [ ] **BE-01** เขียน Prisma migration เพิ่ม `InventoryLot`, `InventoryLotStatus`, index ทั้งหมด (est. 4h)
- [ ] **BE-02** เขียน migration เพิ่ม `QCTemplate`, `QCChecklistItem`, `QCRecord`, `QCResult`, `QCRecordStatus` (est. 3h)
- [ ] **BE-03** เพิ่ม field `lotId` ใน `StockMovement`, `GoodsReceiveItem`, และ field `requiresLotTracking` ใน `InventoryItem` (est. 2h)
- [ ] **BE-04** สร้างโมดูลใหม่ `src/modules/inventory/lots/` — service, controller, module, DTO ครบ (est. 8h)
- [ ] **BE-05** เพิ่ม helper `generateLotNumber()` ใน `DocumentSequence` (docType = 'LOT') (est. 2h)
- [ ] **BE-06** แก้ `stock-movements.service.ts`:
  - เปลี่ยน `Math.random()` UUID → `crypto.randomUUID()` (est. 0.5h)
  - เพิ่ม SERIALIZABLE isolation + SELECT FOR UPDATE สำหรับ outbound (est. 6h)
- [ ] **BE-07** Unit tests สำหรับ lots service (CRUD, quarantine, release, dispose, near-expiry query) ≥ 85% coverage (est. 6h)

### Sprint 2 (Week 3–4) — FEFO + GR integration

- [ ] **BE-08** แก้ `goods-receives.service.ts#create()` ให้:
  - สร้าง `InventoryLot` ต่อ `GoodsReceiveItem` เมื่อ item มี `requiresLotTracking` หรือ `isPerishable`
  - คำนวณ `expiryDate` อัตโนมัติถ้าไม่ส่งมา (`receiveDate + defaultShelfLifeDays`)
  - Link `lotId` เข้า `StockMovement` ที่สร้าง (est. 8h)
- [ ] **BE-09** เพิ่ม FEFO pick logic ใน `stock-movements.service.ts`:
  - Method `pickLotsForIssue(tenantId, itemId, warehouseId, qty)` → returns `Array<{lotId, qty}>`
  - Order: `expiryDate ASC NULLS LAST, receivedDate ASC`
  - Skip status != ACTIVE
  - Split movement เป็นหลาย records ถ้าต้องกินหลาย lot (est. 10h)
- [ ] **BE-10** Update `WarehouseStock` บน `remainingQty` ของ lot (trigger ใน service layer) (est. 4h)
- [ ] **BE-11** Integration test: PO → GR (perishable) → Issue (2 lots split) → ต้องหัก FEFO ถูก (est. 6h)
- [ ] **BE-12** Endpoint enhancement: `/goods-receives` accept `autoCreateLots` + `/stock-movements` รับ `lotId` optional (est. 4h)

### Sprint 3 (Week 5–6) — QR Code

- [ ] **BE-13** ติดตั้ง `qrcode` + `jspdf` (หรือ `pdfkit`) (est. 0.5h)
- [ ] **BE-14** สร้าง `src/common/services/qr-code.service.ts`:
  - `generateSignedPayload(data)` + `verifyPayload(signed)` ใช้ HMAC-SHA256
  - `renderQRBuffer(payload, format, size)` (est. 6h)
- [ ] **BE-15** สร้างโมดูล `src/modules/inventory/qr/` — controller endpoints ตามข้อ 5.2 (est. 6h)
- [ ] **BE-16** PDF label sheet generation (A4 + Avery 5160/5163 templates) (est. 8h)
- [ ] **BE-17** Endpoint `/qr/resolve` + rate-limit เข้มงวด (10 req/min/IP) (est. 3h)
- [ ] **BE-18** Integration tests สำหรับ QR (round-trip sign/verify, reject invalid sig, reject cross-tenant) (est. 4h)
- [ ] **BE-19** เพิ่ม env validation `INVENTORY_QR_SECRET` ใน ConfigModule schema (est. 1h)

### Sprint 4 (Week 7–8) — QC

- [ ] **BE-20** สร้างโมดูล `src/modules/inventory/qc/` — templates, checklist, records, results (est. 10h)
- [ ] **BE-21** Photo upload endpoint via Firebase Storage Admin SDK (ใช้ของเดิมใน `push-notifications` module) (est. 6h)
- [ ] **BE-22** Supplier quality report: aggregate rejection rate / passed rate / avg inspection time ต่อ supplier ต่อเดือน (est. 6h)
- [ ] **BE-23** เชื่อม QC กับ Goods Receive:
  - ถ้า `item.requiresQC` → GR ต้องสร้าง QC record ก่อน เปลี่ยน status → ACCEPTED
  - Failed QC → lot status = DISPOSED, return stock movement = RETURN_SUPPLIER ถ้ามี PO (est. 8h)
- [ ] **BE-24** Unit + integration tests ≥ 80% (est. 6h)

### Sprint 5 (Week 9) — Expiry / Cron / Notifications

- [ ] **BE-25** สร้าง Bull processor `inventory.queue.ts` พร้อม jobs 4 ตัวตามข้อ 6 (est. 8h)
- [ ] **BE-26** Dashboard endpoints (`near-expiry-value`, `expired-waste-last-month`) (est. 4h)
- [ ] **BE-27** Report endpoints (inventory-valuation-by-lot, expiry-schedule) + CSV export (est. 6h)
- [ ] **BE-28** Event subscribers เชื่อม notifications + cost-accounting (est. 4h)
- [ ] **BE-29** เพิ่ม settings schema ใน `tenants` module (est. 2h)

### Sprint 6 (Week 10) — QA, docs, rollout

- [ ] **BE-30** E2E tests ทั้ง flow: PO → GR (พร้อม QC) → Lot → Issue (FEFO) → Near-expiry alert → Auto-waste (est. 8h)
- [ ] **BE-31** Update Swagger + `docs/API_ENDPOINTS_NEW.md` (est. 4h)
- [ ] **BE-32** Performance test: 1000 lots / 10k movements — query FEFO + summary < 200ms (est. 4h)
- [ ] **BE-33** เขียน migration runbook + rollback plan (est. 2h)
- [ ] **BE-34** Feature flag rollout (canary tenant → 10% → 100%) (est. 3h)

**Total estimate:** ~170 hours (≈ 21 person-days ≈ 1 developer × 5 weeks หรือ 2 developers × 3 weeks)

---

## 9. Acceptance Criteria (per feature)

### Lot tracking
- [ ] รับเข้า perishable item แล้วเกิด `InventoryLot` ทุก lot
- [ ] Issue ต้องหักจาก lot ที่ expiry ใกล้ที่สุดก่อนเสมอ
- [ ] `WarehouseStock.quantity` = SUM(lot.remainingQty) ตลอดเวลา (invariant check)
- [ ] ไม่สามารถ issue จาก lot status ≠ ACTIVE

### QR
- [ ] QR ที่ generate จาก tenant A ต้อง resolve ไม่ได้ใน tenant B (HMAC + tenantId check)
- [ ] QR payload ถูกแก้ 1 byte → verify ล้มเหลว
- [ ] PDF A4 sheet ปริ้นออกมาสแกนได้ (test กับ camera app จริง)

### QC
- [ ] Item ที่ `requiresQC=true` ต้องมี QCRecord ก่อน GR เปลี่ยน → ACCEPTED
- [ ] QC FAILED → lot ไม่เข้า stock, ได้ return_supplier movement (ถ้ามี PO)
- [ ] Supplier quality report คำนวณ rejection rate ถูกต้อง

### Expiry
- [ ] Near-expiry alert ออกทุกวัน 06:00 (verify ใน staging)
- [ ] Lot ที่หมดอายุเปลี่ยน status = EXPIRED ภายใน 5 นาทีหลังเที่ยงคืน
- [ ] Waste cost ใน cost-accounting ตรงกับ sum of disposed lot values

---

## 10. Testing Plan

- **Unit:** Jest `npm run test:unit` — ทุก service method ≥ 80% coverage
- **Integration:** `src/integration/*.spec.ts` — full flow PO→GR→Lot→Issue→Expire
- **E2E:** `test/e2e/inventory-lot.e2e-spec.ts` — ผ่าน Supertest + test database (Prisma SQLite หรือ dedicated test schema)
- **Performance:** K6 script สำหรับ goods-receive endpoint (100 concurrent receivers)
- **Security:** QR tampering, cross-tenant access, rate limit resolve endpoint

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Lot migration ของ existing data ผิดพลาด | Medium | High | ทำ backfill script แบบ dry-run ก่อน + review manual, รัน tenant ละ 1 ราย |
| FEFO บังคับใช้แล้ว legacy flow ของ restaurant จะพัง | Medium | High | Feature flag ต่อ item (`requiresLotTracking`) → enable ทีละกลุ่ม, restaurant F&B เปิดก่อน housekeeping amenities |
| QR secret รั่ว → ปลอม QR ได้ | Low | Medium | Rotate secret ผ่าน env + audit log + include tenant binding ใน payload |
| SELECT FOR UPDATE ช้าเกินไปบน MySQL | Medium | Medium | Benchmark ก่อน ถ้าเกิน 100ms → เปลี่ยนเป็น optimistic locking |
| Expired cron ทำงาน long-running block Bull queue | Low | Medium | Process ทีละ batch (100 rows/iteration) + concurrency=1 |

---

## 12. References

- Current `goods-receives.service.ts` — `src/modules/inventory/goods-receives/goods-receives.service.ts`
- Current `stock-movements.service.ts` — `src/modules/inventory/stock-movements/stock-movements.service.ts`
- Prisma schema — `prisma/schema.prisma` (line 2241 onwards for inventory)
- Cost accounting events — `src/modules/cost-accounting/events/cost-accounting.events.ts`
- Frontend companion plan — `owner-hotel-services/docs/tasks/2026-Q2-inventory-lot-qc-qr-plan.md`

---

**Approval:** _________________ (Tech Lead)  &nbsp;&nbsp; _________________ (Product)
