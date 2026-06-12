# แผนพัฒนา: เชื่อม Recruitment → คลัง/จัดซื้อ/บัญชี + การวนหาคนใหม่

> **Status:** Draft รออนุมัติ · **Date:** 2026-06-11 · **Author:** Claude
> **ต่อยอดจาก:** `2026-06-10-recruitment-to-probation-redesign.md` (pipeline เดิมที่ลงเสร็จแล้ว)
> **Scope:** Backend เป็นหลัก (event-driven) + Frontend บางส่วน

---

## 0. หลักการออกแบบ (ยึดตาม pattern จริงของระบบ)

1. **Event-driven** — ระบบมี `CostEventListener` + `EventEmitter2` กลางอยู่แล้ว recruitment เป็น "ผู้ส่ง event" ไม่เขียน cost/stock เอง
2. **Graceful degradation** — ทุก integration เช็ค addon ก่อน ถ้าไม่มีก็ข้ามเงียบ ไม่ block/ไม่ error · ฟีเจอร์หลัก recruitment ทำงานได้เสมอแม้ซื้อแค่ HR
3. **Double-gate** — เช็ค addon ทั้งฝั่งผู้ส่ง (ก่อน emit) และฝั่ง listener (ก่อน post)
4. **ความเป็นเจ้าของ** — ต้นทุน/PR/การจอง ผูกกับ "แผนกที่ขอ" เสมอ จัดซื้อ/HR เป็นผู้จัดหา/ส่งมอบ
5. **จองของแบบ B** — reserve ตอนจ้างสำเร็จเท่านั้น

---

## 1. สรุปพฤติกรรมตามชุดการซื้อ (เป้าหมาย)

| ฟีเจอร์ | HR เดี่ยว | HR+คลัง | HR+บัญชี | ครบ |
|---|:---:|:---:|:---:|:---:|
| pipeline 7 stage | ✅ | ✅ | ✅ | ✅ |
| ใบเบิก (checklist) | ✅ | ✅ | ✅ | ✅ |
| เช็คคลัง/ป้ายมี-ต้องสั่ง | ❌ | ✅ | ❌ | ✅ |
| จองของ/ตัดสต๊อก/คืน | ❌ | ✅ | ❌ | ✅ |
| ออก PR (ของขาด) | ❌ | ✅ | ❌ | ✅ |
| จองงบ cost_budgets | ❌ | ❌ | ✅ | ✅ |
| post ต้นทุน | ❌ | ❌ | ✅ | ✅ |

> จัดซื้ออยู่ใต้ `INVENTORY_MODULE` (ไม่มี addon code แยก) → ซื้อคลัง = ได้จัดซื้อด้วย

---

## 2. แผนแบ่งเฟส

### เฟส 0 — แก้ของค้าง + รากฐาน (เล็ก, ทำก่อน)
- เพิ่มฟิลด์ `costCenterId` (nullable) ใน `HrDepartment` → ตาราง mapping แผนก ↔ cost center
- เพิ่มฟิลด์ `itemId` (nullable) + `warehouseId` (nullable) ใน equipment item / issuance item เพื่อรองรับ 2 โหมด (ผูกคลัง / checklist)
- migration + seeder map แผนกเดิม → cost center ที่มี
- **ไฟล์:** `prisma/schema.prisma`, migration ใหม่, `seeder.service.ts`

### เฟส A — วนหาคนใหม่ให้สมบูรณ์ (backend ล้วน, ไม่พึ่ง addon)
ปิดช่องที่ปัจจุบันคำขอค้างเมื่อผู้สมัครหลุด:
- `recordResult` (fail) + reschedule (no_show) → เช็คผู้สมัคร active ที่เหลือ ถ้าไม่เหลือ set คำขอ = `recruiting`
- เพิ่ม endpoint `POST /hr/hire-records/:id/cancel` (ไม่มารายงานตัว) → ปลดจอง (ถ้ามี) + Employee → cancelled + คำขอ → `recruiting`
- รองรับ headcount > 1 (จ้างครบโควต้าจึงปิดคำขอ)
- **ไฟล์:** `interview.service.ts`, `candidate.service.ts`, `hire.service.ts`, controller + specs

### เฟส B — เชื่อมคลัง/จัดซื้อ (gate: INVENTORY_MODULE)
- **Stage 3:** ผูก equipment item ↔ InventoryItem (SmartSelect) + เช็ค `WarehouseStock.quantity` → ป้าย 🟢มี/🔴ต้องสั่ง · ของขาด → สร้าง `PurchaseRequisition` (department = แผนกที่ขอ, requestedBy = ระบบ/HR)
- **Stage 5 (จ้าง):** ของพอ → จอง(reserved) · เพิ่ม field reserved tracking
- **Stage 6 (จ่าย/คืน):** จ่าย → emit `stock_movement` (GOODS_ISSUE, referenceType='equipment_issuance') · คืน → movement ย้อนกลับ
- **Degradation:** ถ้า !hasInventory → ใบเบิกเป็น checklist อิสระ ซ่อนป้าย ไม่ตัดสต๊อก ไม่ออก PR
- **ไฟล์:** `equipment-request.service.ts`, `hr-equipment-issuance.service.ts`, event emit, frontend equipment/issuance pages

### เฟส C — เชื่อมบัญชี/ต้นทุน (gate: COST_ACCOUNTING_MODULE)
- เพิ่ม event ใหม่ใน `cost-accounting.events.ts`: `RECRUITMENT_BUDGET_RESERVED`, `RECRUITMENT_SALARY_COMMITTED`
- เพิ่ม handler ใน `CostEventListener`: `handleBudgetReserved` (เขียน `CostBudget` upsert), `handleSalaryCommitted` (เขียน `CostEntry`)
- ขยาย mapping ใน listener: `equipment_issuance` + dynamic departmentId → cost center (ใช้ `HrDepartment.costCenterId` จากเฟส 0)
- **Stage 2:** อนุมัติงบครบ → emit `budget_reserved`
- **Stage 5:** จ้าง → emit `salary_committed`
- **ไฟล์:** `cost-accounting.events.ts`, `cost-event.listener.ts`, `manpower-request.service.ts`, `hire.service.ts`

### เฟส D — เก็บงาน + UI สถานะ integration
- หน้า detail แสดงสถานะการเชื่อม (PR เลขที่ไหน, สต๊อกตัดแล้ว, ต้นทุน posted) เมื่อมี addon
- ตั้งค่า department ↔ cost center ในหน้า master-data
- เอกสาร + AI log

---

## 3. ลำดับ dependency

```
เฟส 0 (รากฐาน) ──┬──► เฟส A (วนหาคน — อิสระ ทำขนานได้)
                 ├──► เฟส B (คลัง — ต้องการ itemId จากเฟส 0)
                 └──► เฟส C (บัญชี — ต้องการ costCenterId จากเฟส 0)
เฟส B + C ──► เฟส D (UI + เก็บงาน)
```

## 4. ความเสี่ยง / จุดต้องตัดสินใจ
- เฟส 0 แก้ schema กระทบหลายที่ — ต้องรัน migrate + regenerate prisma บนเครื่อง
- การ map แผนก → cost center ต้องมี fallback (CC-ADMIN) ถ้า tenant ยังไม่ตั้ง
- reserved tracking: schema `WarehouseStock` ไม่มี field reserved แยก — ต้องเพิ่ม หรือคำนวณจาก issuance ที่ status=reserved

## 5. แนะนำเริ่ม
เฟส 0 → A (เห็นผลเร็ว ไม่พึ่ง addon) → B → C → D
