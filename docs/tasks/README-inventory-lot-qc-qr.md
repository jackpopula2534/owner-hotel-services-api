# 📦 Inventory Lot / QR / QC / Expiry — Master Overview

**Initiative:** ยกระดับระบบคลังสินค้าของ StaySync ให้รองรับ lot-level traceability, QR code (by-item / by-lot), QC workflow, และ expiry control
**Timeline:** 2026-Q2 (10 สัปดาห์ / 6–7 sprints)
**Created:** 2026-04-18
**Updated:** 2026-04-18

---

## 🎯 วัตถุประสงค์

หลังจากวิเคราะห์ระบบปัจจุบัน (ดูประวัติสนทนา 2026-04-18) พบว่าระบบ Purchase Order → Goods Receive → Stock Movement → Warehouse Stock ทำงานได้ครบที่ backend แต่ยังขาดความสามารถ 5 ด้านที่จำเป็นสำหรับการควบคุมต้นทุนและ traceability ของธุรกิจโรงแรมและร้านอาหาร:

1. **UI รับเข้า PO** — Backend พร้อม แต่ Frontend ยังไม่มี
2. **Lot / Batch tracking** — เก็บ `batchNumber` เป็น string แต่ไม่ได้เป็น entity แยก
3. **QR Code auto-generation** — By Item และ By Lot พร้อม scan/resolve
4. **QC (Quality Control)** — มี reject field แต่ยังไม่มี checklist / photo / supplier quality report
5. **Expiry control** — มี field แต่ไม่มี cron แจ้งเตือน / auto-waste

---

## 📄 เอกสารที่เกี่ยวข้อง

| ประเภท | ที่ตั้ง |
|---|---|
| Backend plan (รายละเอียด) | `owner-hotel-services-api/docs/tasks/2026-Q2-inventory-lot-qc-qr-plan.md` |
| Frontend plan (รายละเอียด) | `owner-hotel-services/docs/tasks/2026-Q2-inventory-lot-qc-qr-plan.md` |
| Master overview (ไฟล์นี้) | `owner-hotel-services-api/docs/tasks/README-inventory-lot-qc-qr.md` |
| Existing inventory schema | `owner-hotel-services-api/prisma/schema.prisma` (line 2162–2650) |

---

## 📅 Timeline สรุป

```
Week  1 2 3 4 5 6 7 8 9 10
BE   [====================][======][====][====][==][==]
     └ Foundation │ FEFO+GR │ QR │ QC │ Cron │ QA
FE       [====][====][====][==][====][==][==]
         └ Types │ GR │ Lot│QR│ QC │ Polish │QA
```

- Week 1–2: Foundation (types, migrations, stores)
- Week 3–4: Goods Receive UI (P0) + FEFO backend
- Week 5: Lot management UI + FEFO integration
- Week 6: QR Code (gen + scan + print)
- Week 7–8: QC workflow (template + runner + photos + report)
- Week 9: Expiry dashboard + cron jobs
- Week 10: QA, E2E, rollout

---

## ✅ Phase checklist (สำหรับ PM tracking)

### Phase 1 — Goods Receive UI (P0, blocker)
- [ ] BE: ปรับ `goods-receives.service.ts` รับ `createLots: true` flag
- [ ] FE: สร้าง `/dashboard/inventory/goods-receives/*` pages 3 หน้า
- [ ] FE: ปุ่ม "สร้างใบรับเข้า" ใน PO detail modal
- [ ] QA: Cypress happy path PO → GR
- **Deliverable:** พนักงานคลังรับเข้าสินค้าจาก PO ได้ผ่าน UI

### Phase 2 — Lot Tracking (P0, core)
- [ ] BE: Prisma migration `InventoryLot` + status enum + index
- [ ] BE: Module `inventory/lots/*` service + controller + DTO
- [ ] BE: แก้ GR ให้สร้าง lot อัตโนมัติเมื่อ perishable
- [ ] BE: FEFO pick logic ใน stock-movements (split lot ได้)
- [ ] BE: Concurrency: SELECT FOR UPDATE + SERIALIZABLE + crypto.randomUUID
- [ ] FE: Lot list + detail + near-expiry pages
- [ ] FE: `CreateStockMovementModal` แสดง FEFO lot picker
- [ ] QA: Integration test PO → GR → Issue (2 lots split)
- **Deliverable:** Trace lot ตั้งแต่รับเข้าจนเบิกออกได้ 100%

### Phase 3 — QR Code (P1)
- [ ] BE: `qr-code.service.ts` (HMAC sign/verify)
- [ ] BE: Endpoints `/items/:id/qr`, `/lots/:id/qr`, `/labels`, `/qr/resolve`
- [ ] BE: PDF A4 label sheet (Avery templates)
- [ ] FE: `QRCodeViewer`, `QRScannerModal` (@zxing), `QRLabelSheetPrint`
- [ ] FE: เพิ่ม scan button ใน GR form + stock movement modal
- [ ] QA: Print ทดสอบสแกน + cross-tenant reject
- **Deliverable:** Scan QR บน mobile/tablet ทำรายการรับ–เบิกได้

### Phase 4 — QC (P1)
- [ ] BE: Models `QCTemplate`, `QCChecklistItem`, `QCRecord`, `QCResult`
- [ ] BE: Module `inventory/qc/*` + photo upload (Firebase Storage)
- [ ] BE: Supplier quality report aggregation
- [ ] BE: เชื่อม QC ↔ GR (requiresQC → ต้อง QC pass ก่อน accept)
- [ ] FE: Template editor + checklist drag-drop
- [ ] FE: Mobile runner + offline draft + camera
- [ ] FE: Supplier quality report หน้า
- **Deliverable:** พนักงาน QC ใช้ tablet ที่คลังเช็คสินค้าได้ครบวงจร พร้อมภาพถ่าย

### Phase 5 — Expiry Control (P1)
- [ ] BE: Bull jobs: `check-near-expiry` (daily 06:00), `auto-expire-lots` (daily 00:05), `qc-reminder` (every 4h), optional `auto-waste-expired`
- [ ] BE: Dashboard + report endpoints
- [ ] BE: Event bridge → notifications + cost-accounting
- [ ] BE: Tenant settings schema
- [ ] FE: Expiry alert inbox ใน navbar
- [ ] FE: Expiry dashboard + waste cost chart
- [ ] FE: Report download (CSV/Excel)
- **Deliverable:** Manager ทราบล่วงหน้า 30/14/7/1 วันก่อนสินค้าหมดอายุ, มูลค่า waste ถูกบันทึกต้นทุน

### Phase 6 — QA & Rollout
- [ ] E2E Playwright / Supertest: 3 flows หลัก
- [ ] Performance: FEFO query < 200ms, bundle +80KB max
- [ ] Feature flag (`INVENTORY_LOT_ENABLED`) per tenant
- [ ] Pilot 1 โรงแรม → 10% tenants → 100%
- [ ] User docs (ภาษาไทย) ให้ staff คลัง

---

## 👥 Team Assignment (แนะนำ)

| Role | Sprint 1–2 | Sprint 3–4 | Sprint 5–6 | Sprint 7+ |
|---|---|---|---|---|
| BE Dev 1 | Migration + Lots module | FEFO + GR integration | QR service | QC + cron |
| BE Dev 2 | (support / code review) | Stock-movements refactor | QC models | E2E tests |
| FE Dev 1 | Types + API client + stores | GR UI | Lot UI | QC runner |
| FE Dev 2 | Shared components | GR line row + PO integration | QR components | Expiry dashboard |
| QA | Test planning | GR regression | Lot + QR scan | Full E2E + pilot |

**Minimum viable team:** 1 BE + 1 FE + 0.5 QA = ~10 สัปดาห์
**Accelerated team:** 2 BE + 2 FE + 1 QA = ~6 สัปดาห์

---

## 🎚 Success Metrics

หลัง rollout 30 วัน — ควรเห็นตัวเลขดังนี้:

- ≥ 80% ของ perishable items มี lot tracking
- Waste cost จาก expiry **ลดลง ≥ 30%** เทียบกับเดือนก่อน (FEFO บังคับ)
- GR cycle time (เวลารับเข้าต่อใบ) **ลดลง ≥ 40%** (จาก scanner + auto-fill)
- QC rejection rate แสดง visibility ต่อ supplier ทั้งหมด (baseline เก็บก่อน)
- 0 incident ของ cross-tenant QR leak

---

## 🔗 Dependencies & Blockers

**ก่อนเริ่ม Phase 1:**
- ✅ ต้อง merge PR ที่เกี่ยวกับ `document-settings` module ก่อน (ไม่ conflict กับ DocumentSequence)
- ✅ ตรวจว่า Firebase Storage bucket config มี path `inventory-qc-photos/` ready

**ก่อนเริ่ม Phase 3 (QR):**
- ⚠️ Env var ใหม่ `INVENTORY_QR_SECRET` (min 32 bytes random) ต้อง rotate plan

**ก่อนเริ่ม Phase 4 (QC):**
- ⚠️ Firebase Admin SDK credentials ใน staging + prod — verify quota

**ก่อน rollout Phase 5 (expiry cron):**
- ⚠️ Bull queue workers ต้อง scaling (เพิ่ม 1 worker process) — coordinate กับ DevOps

---

## 📝 การใช้งานเอกสารนี้

- **PM / Tech Lead:** ใช้ phase checklist ด้านบนเป็น source of truth สำหรับ status update รายสัปดาห์
- **BE Developer:** อ่าน backend plan ฉบับเต็ม → เริ่มจาก Sprint 1 BE-01
- **FE Developer:** อ่าน frontend plan ฉบับเต็ม → เริ่มจาก Sprint 1 FE-01 (พัฒนา parallel กับ BE ได้โดยใช้ MSW mock)
- **QA:** อ่าน Acceptance Criteria ทั้ง 2 เอกสาร → เตรียม test plan เป็น Gherkin scenarios

---

**Next action:** Tech Lead + Product Owner approve scope → kick-off meeting + สร้าง Jira/Linear epic + assign Sprint 1 tasks
