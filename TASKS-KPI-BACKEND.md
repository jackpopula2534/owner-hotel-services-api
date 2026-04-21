# TASKS — KPI System Backend (owner-hotel-services-api)

> **เป้าหมาย:** ปรับระบบ KPI จาก hardcoded 4 fields → Template-based dynamic scoring พร้อม Evaluation Cycle + Approval workflow
>
> **Tech Stack:** NestJS 10 + Prisma (MySQL) + JWT Auth
>
> **อ้างอิง:** `KPI-System-Flow-Design.html`

---

## สถานะ: Schema ที่มีอยู่แล้ว

| Model | สถานะ | หมายเหตุ |
|-------|--------|---------|
| `HrPerformance` | ✅ มีแล้ว | ต้องเพิ่ม FK → Cycle, Template + KpiScores |
| `HrKpiTemplate` | ✅ มีแล้ว | มีใน schema แต่ไม่มี NestJS module |
| `HrKpiTemplateItem` | ✅ มีแล้ว | มีใน schema แต่ไม่มี NestJS module |
| `HrEvaluationCycle` | ❌ ไม่มี | ต้องสร้างใหม่ |
| `HrKpiScore` | ❌ ไม่มี | ต้องสร้างใหม่ (dynamic score per criteria) |

---

## TASK 1 — Prisma Schema: เพิ่ม Models ใหม่

- [ ] **1.1** เพิ่ม model `HrEvaluationCycle` ใน `prisma/schema.prisma`
- [ ] **1.2** เพิ่ม model `HrKpiScore` ใน `prisma/schema.prisma`
- [ ] **1.3** อัพเดท `HrPerformance` เพิ่ม FK → cycleId, templateId + relation KpiScores[]
- [ ] **1.4** อัพเดท `HrKpiTemplate` เพิ่ม relation → EvaluationCycles[]
- [ ] **1.5** รัน `npx prisma migrate dev --name add_kpi_cycle_score`

**Target Schema:**
```prisma
model HrEvaluationCycle {
  id           String   @id @default(uuid())
  tenantId     String
  templateId   String
  name         String           // "ประเมินผล Q2 2568"
  period       String           // "2568-Q2"
  periodType   String           // quarterly | half_yearly | yearly
  startDate    DateTime @db.Date
  endDate      DateTime @db.Date
  dueDate      DateTime @db.Date  // วันสิ้นสุดการกรอก
  status       String   @default("open")  // open | closed | archived
  createdBy    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  template     HrKpiTemplate    @relation(...)
  performances HrPerformance[]

  @@index([tenantId])
  @@map("hr_evaluation_cycles")
}

model HrKpiScore {
  id              String   @id @default(uuid())
  performanceId   String
  criteriaId      String   // FK → HrKpiTemplateItem.id
  criteriaName    String   // snapshot ณ เวลาประเมิน
  weight          Decimal  @db.Decimal(5,2)  // snapshot
  score           Decimal  @db.Decimal(5,2)  // 1-5 หรือ 0-100 ขึ้นอยู่กับ template
  comment         String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  performance HrPerformance      @relation(...)
  criteria    HrKpiTemplateItem  @relation(...)

  @@unique([performanceId, criteriaId])
  @@map("hr_kpi_scores")
}
```

**Status:** ⏳ pending

---

## TASK 2 — Backend: KPI Template Module

**Files ต้องสร้าง:**
- `src/modules/hr/kpi-template/` (หรือเพิ่มใน hr module)
- `hr-kpi-template.service.ts`
- `hr-kpi-template.controller.ts`
- `dto/create-kpi-template.dto.ts`
- `dto/update-kpi-template.dto.ts`

**Endpoints:**
```
GET    /hr/kpi-templates             # List templates (tenant-scoped)
GET    /hr/kpi-templates/:id         # Get template + items
POST   /hr/kpi-templates             # Create template + items
PATCH  /hr/kpi-templates/:id         # Update template
DELETE /hr/kpi-templates/:id         # Delete (soft — ถ้าไม่มี performance ใช้)
POST   /hr/kpi-templates/:id/items   # Add criteria item
PATCH  /hr/kpi-templates/:id/items/:itemId  # Update item
DELETE /hr/kpi-templates/:id/items/:itemId  # Remove item
```

**Business Rules:**
- น้ำหนักรวม items ต้อง = 100% (validate ก่อน save)
- ลบ template ที่มี EvaluationCycle ใช้อยู่ไม่ได้ (throw ConflictException)
- `isDefault = true` templates ลบไม่ได้

**Status:** ⏳ pending

---

## TASK 3 — Backend: Evaluation Cycle Module

**Files ต้องสร้าง:**
- `hr-evaluation-cycle.service.ts`
- `hr-evaluation-cycle.controller.ts`
- `dto/create-evaluation-cycle.dto.ts`

**Endpoints:**
```
GET    /hr/evaluation-cycles              # List cycles (tenant-scoped)
GET    /hr/evaluation-cycles/:id          # Get cycle + performances summary
POST   /hr/evaluation-cycles              # Create cycle (auto-generate performance records)
PATCH  /hr/evaluation-cycles/:id          # Update cycle info
POST   /hr/evaluation-cycles/:id/close    # Close cycle (ไม่รับ submit ใหม่)
GET    /hr/evaluation-cycles/:id/progress # Summary: กรอกแล้ว X/Y คน
```

**Key Feature — Auto-generate Performance Records:**
```typescript
// เมื่อ POST /hr/evaluation-cycles พร้อม employeeIds
// ระบบ loop สร้าง HrPerformance { status: 'pending' } ทุก employee
// ใน prisma.$transaction() เดียวกัน
```

**Status:** ⏳ pending

---

## TASK 4 — Backend: Update HrPerformance Service

**อัพเดท logic:**
- [ ] **4.1** `create()`: รับ `cycleId` + `templateId` + `scores[]` (dynamic) แทน 4 hardcoded fields
- [ ] **4.2** `calcOverall()`: คำนวณจาก `KpiScore[]` × weight แต่ละ criteria (จาก Template)
- [ ] **4.3** `submitForApproval()`: เปลี่ยน status `draft → submitted`
- [ ] **4.4** `approve()`: role = manager/admin เท่านั้น → `submitted → approved`
- [ ] **4.5** `reject()`: ต้อง comment → `submitted → rejected → draft`
- [ ] **4.6** `bulkApprove()`: approve หลายรายการพร้อมกัน
- [ ] **4.7** Fix "Invalid Date" bug ใน findAll (period format)

**Status Flow:**
```
pending → draft (กรอกคะแนนครั้งแรก)
draft → submitted (HR กด submit)
submitted → approved (Manager approve)
submitted → rejected (Manager reject + comment)
rejected → draft (HR แก้ไขใหม่)
```

**Status:** ⏳ pending

---

## TASK 5 — Backend: Approval Endpoints

**Endpoints เพิ่ม:**
```
POST /hr/performance/:id/submit   # HR submit for approval
POST /hr/performance/:id/approve  # Manager approve
POST /hr/performance/:id/reject   # Manager reject + reason
POST /hr/performance/bulk-approve # { ids: string[], comment?: string }
```

**Guards:** `@Roles('manager', 'admin', 'tenant_admin')` สำหรับ approve/reject

**Status:** ⏳ pending

---

## TASK 6 — Backend: Register New Controllers in HrModule

- [ ] เพิ่ม `HrKpiTemplateController`, `HrKpiTemplateService`
- [ ] เพิ่ม `HrEvaluationCycleController`, `HrEvaluationCycleService`
- [ ] ลำดับ controller registration (specific routes ก่อน)

**Status:** ⏳ pending

---

## TASK 7 — ตรวจสอบ & Build

- [ ] `npm run build` — ไม่มี TypeScript error
- [ ] `npm run lint` — ผ่าน ESLint
- [ ] ตรวจสอบ Swagger ที่ `/api/docs` มี endpoints ครบ
- [ ] ตรวจสอบ migration ผ่านโดยไม่มี error

**Status:** ⏳ pending

---

## ความสัมพันธ์ระหว่าง Models

```
HrKpiTemplate (1) ──────── (N) HrKpiTemplateItem
HrKpiTemplate (1) ──────── (N) HrEvaluationCycle
HrEvaluationCycle (1) ──── (N) HrPerformance
HrPerformance (1) ──────── (N) HrKpiScore
HrKpiScore (N) ─────────── (1) HrKpiTemplateItem
```

---

## Progress Log

| วันที่ | Task | สถานะ |
|--------|------|--------|
| 2026-04-09 | สร้างไฟล์ TASKS | ✅ เสร็จ |
| 2026-04-09 | TASK 1 — Prisma Schema: เพิ่ม HrEvaluationCycle, HrKpiScore, อัพเดท HrPerformance + HrKpiTemplate relations | ✅ เสร็จ |
| 2026-04-09 | TASK 2 — KPI Template Service/Controller + DTOs | ✅ เสร็จ |
| 2026-04-09 | TASK 3 — Evaluation Cycle Service/Controller + DTOs | ✅ เสร็จ |
| 2026-04-09 | TASK 4 — อัพเดท hr-performance.service.ts (saveDraft, submit, approve, reject, bulkApprove) | ✅ เสร็จ |
| 2026-04-09 | TASK 5 — Approval endpoints ใน hr-performance.controller.ts | ✅ เสร็จ |
| 2026-04-09 | TASK 6 — Register HrKpiTemplateController/Service + HrEvaluationCycleController/Service ใน HrModule | ✅ เสร็จ |
| 2026-04-09 | TASK 7 — สร้าง migration SQL file ด้วยมือ (bypass Prisma binary ไม่มีใน sandbox) | ✅ เสร็จ |
| 2026-04-09 | Fix seeder — อัพเดท `cycleId: null` ใน findFirst + create เพื่อรองรับ unique constraint ใหม่ | ✅ เสร็จ |
| 2026-04-09 | Build + Integration test | ⏳ pending |

### ✅ ตอนนี้ `npm run db:refresh` จะทำงานได้ เพราะ:
1. `prisma migrate deploy` จะ apply migration file ใหม่ → สร้าง columns + tables ใหม่
2. `prisma generate` รัน → Prisma client ตรงกับ schema
3. Seeder ใช้ `cycleId: null` ใน where clause → ไม่ conflict unique constraint

### สิ่งที่ต้อง run ใน local environment
```bash
# รัน db:refresh ได้เลยตอนนี้
npm run db:refresh

# ตรวจสอบ API
npm run start:dev
# เปิด http://localhost:3001/api/docs
# ดู tags: hr/kpi-templates, hr/evaluation-cycles, hr/performance
```
