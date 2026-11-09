# Design: ระบบ Recruitment → Probation (รื้อใหม่ทั้ง flow)

> **Status:** Draft รอรีวิว · **Date:** 2026-06-10 · **Author:** Claude
> **Scope:** Backend (owner-hotel-services-api) + Frontend (owner-hotel-services)
> **แทนที่:** `HrProbationReview` เดิม (P2-04) ทั้งหมด

---

## 1. ภาพรวม Flow (7 Stage)

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 1. ขอกำลังพล  │──▶│ 2. ขออนุมัติงบ │──▶│ 3. ขออุปกรณ์  │──▶│ 4. สัมภาษณ์    │
│  (Manpower)  │   │  (Budget)    │   │ (Equipment)  │   │ (Interview)  │
└──────────────┘   └──────────────┘   └──────────────┘   └──────┬───────┘
                                                                │
┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│ 7. ทดลองงาน   │◀──│ 6. รับของเบิก │◀──│ 5. จ้าง/วันเริ่ม │◀────────┘
│ (Probation)  │   │ (Issuance)   │   │ (Hire/Offer) │
└──────────────┘   └──────────────┘   └──────────────┘
```

ทุก stage ผูกกับ **HrManpowerRequest** เป็นแกนกลาง (1 request = 1 อัตราที่ขอ หรือหลายอัตราใน position เดียวกัน)
Stage 3 (อุปกรณ์) ทำขนานกับ stage 4 ได้ — ไม่ block กัน แต่ต้อง approved ก่อนถึง stage 6

### State Machine ของ HrManpowerRequest

```
draft → pending_approval → budget_pending → budget_approved
      → recruiting → interviewing → offer_made → hired
      → onboarding → probation → completed
   ↘ rejected / cancelled (จากทุก state ก่อน hired)
```

---

## 2. Approval หลายขั้นตามลำดับ

ใช้ pattern เดียวกับ `hr-leave` (approvalChain JSON) แต่ยกเป็น **shared type** ใน `common/`:

```typescript
// common/types/approval-chain.ts
interface ApprovalStep {
  level: number;                 // 1, 2, 3...
  role: 'dept_head' | 'hr' | 'owner';
  approverId: string | null;     // ใครกด (เติมตอน approve)
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  note: string | null;
}
type ApprovalChain = ApprovalStep[];
```

- **Default chain:** หัวหน้าแผนก → HR → เจ้าของโรงแรม (3 ขั้น)
- chain แยกอิสระ 3 จุด: ขอกำลังพล, ขออนุมัติงบ, ขออุปกรณ์
- reject ที่ขั้นไหนก็ได้ → request กลับเป็น `rejected` พร้อม note (แก้แล้ว resubmit ได้ → reset chain)
- เก็บเป็น JSON column + sync `currentApprovalLevel` ไว้ query/filter

---

## 3. Prisma Schema (ใหม่ทั้งหมด)

```prisma
// ── Stage 1+2: ขอกำลังพล + งบ ───────────────────────────────
model HrManpowerRequest {
  id                String    @id @default(uuid())
  tenantId          String
  propertyId        String?
  requestNo         String    // MPR-2026-0001 (gen per tenant)
  departmentId      String?
  positionId        String?
  positionTitle     String    // เผื่อ position ใหม่ที่ยังไม่มี master
  headcount         Int       @default(1)
  employmentType    String    @default("FULLTIME")
  reason            String    @db.Text   // replacement | expansion | new_role
  jobDescription    String?   @db.Text
  expectedStartDate DateTime? @db.Date

  // Budget (stage 2 — chain แยก)
  salaryRangeMin    Decimal?  @db.Decimal(12, 2)
  salaryRangeMax    Decimal?  @db.Decimal(12, 2)
  budgetTotal       Decimal?  @db.Decimal(12, 2)  // รวม onboarding cost
  budgetNote        String?   @db.Text
  budgetChain       Json?     // ApprovalChain
  budgetApprovedAt  DateTime?

  status                String   @default("draft")
  approvalChain         Json?    // ApprovalChain ของตัว request
  currentApprovalLevel  Int      @default(0)
  requestedBy           String   // userId
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  equipmentRequests HrEquipmentRequest[]
  candidates        HrCandidate[]

  @@unique([tenantId, requestNo])
  @@index([tenantId, status])
  @@map("hr_manpower_requests")
}

// ── Stage 3: ขออุปกรณ์ ──────────────────────────────────────
model HrEquipmentRequest {
  id                String    @id @default(uuid())
  tenantId          String
  manpowerRequestId String
  items             Json      // [{ name, qty, estimatedCost, note }]
  totalCost         Decimal?  @db.Decimal(12, 2)
  status            String    @default("pending") // pending|approved|rejected|procured|ready
  approvalChain     Json?
  requestedBy       String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  manpowerRequest   HrManpowerRequest @relation(fields: [manpowerRequestId], references: [id], onDelete: Cascade)
  issuances         HrEquipmentIssuance[]

  @@index([tenantId, status])
  @@map("hr_equipment_requests")
}

// ── Stage 4: ผู้สมัคร + นัดสัมภาษณ์ ─────────────────────────
model HrCandidate {
  id                String   @id @default(uuid())
  tenantId          String
  manpowerRequestId String
  firstName         String
  lastName          String
  email             String?
  phone             String?
  resumeUrl         String?
  source            String?  // walk_in | referral | job_board | agency
  expectedSalary    Decimal? @db.Decimal(12, 2)
  status            String   @default("applied")
  // applied → screening → interview_scheduled → interviewed
  //         → offer_made → offer_accepted → hired | rejected | withdrawn
  note              String?  @db.Text
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  manpowerRequest   HrManpowerRequest @relation(fields: [manpowerRequestId], references: [id], onDelete: Cascade)
  interviews        HrInterview[]
  hireRecord        HrHireRecord?

  @@index([tenantId, manpowerRequestId, status])
  @@map("hr_candidates")
}

model HrInterview {
  id            String    @id @default(uuid())
  tenantId      String
  candidateId   String
  round         Int       @default(1)
  scheduledAt   DateTime  // วัน-เวลานัด
  location      String?   // หรือ video call link
  interviewerIds Json     // [userId, ...]
  status        String    @default("scheduled") // scheduled|completed|no_show|cancelled|rescheduled
  score         Decimal?  @db.Decimal(5, 2)
  feedback      String?   @db.Text
  result        String?   // pass | fail | next_round
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  candidate     HrCandidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@index([tenantId, scheduledAt])
  @@map("hr_interviews")
}

// ── Stage 5: จ้าง + วันเวลาเริ่มงาน ─────────────────────────
model HrHireRecord {
  id              String    @id @default(uuid())
  tenantId        String
  candidateId     String    @unique
  employeeId      String?   @unique  // เติมเมื่อสร้าง Employee แล้ว
  offeredSalary   Decimal   @db.Decimal(12, 2)
  startDate       DateTime  // วันเริ่มงาน
  startTime       String?   // "08:30" — เวลารายงานตัว
  probationDays   Int       @default(90)
  offerStatus     String    @default("offered") // offered|accepted|declined|expired
  offerSentAt     DateTime?
  acceptedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  candidate       HrCandidate @relation(fields: [candidateId], references: [id])
  employee        Employee?   @relation(fields: [employeeId], references: [id])

  @@map("hr_hire_records")
}

// ── Stage 6: รับของเบิกวันแรก ───────────────────────────────
model HrEquipmentIssuance {
  id                 String    @id @default(uuid())
  tenantId           String
  equipmentRequestId String
  employeeId         String
  items              Json      // [{ name, qty, serialNo?, issued: bool }]
  status             String    @default("pending") // pending|partially_issued|issued|returned
  issuedBy           String?
  issuedAt           DateTime?
  acknowledgedAt     DateTime? // พนักงานเซ็นรับ
  signatureUrl       String?
  note               String?   @db.Text
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  equipmentRequest   HrEquipmentRequest @relation(fields: [equipmentRequestId], references: [id])
  employee           Employee           @relation(fields: [employeeId], references: [id])

  @@index([tenantId, employeeId])
  @@map("hr_equipment_issuances")
}

// ── Stage 7: ทดลองงาน (แทน HrProbationReview เดิม) ──────────
model HrProbationRound {
  id           String    @id @default(uuid())
  tenantId     String
  employeeId   String
  hireRecordId String?   // เชื่อมกลับไปต้นทาง recruitment (null = เปิด manual)
  startDate    DateTime  @db.Date
  dueDate      DateTime  @db.Date
  extendedFrom String?   // probationRoundId เดิม กรณีต่อเวลา
  status       String    @default("active") // active|passed|extended|failed|cancelled
  decidedBy    String?
  decidedAt    DateTime?
  decisionNote String?   @db.Text
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  employee     Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  checkpoints  HrProbationCheckpoint[]

  @@index([tenantId, status])
  @@index([employeeId])
  @@map("hr_probation_rounds")
}

model HrProbationCheckpoint {
  id          String    @id @default(uuid())
  tenantId    String
  roundId     String
  label       String    // "30 วัน", "60 วัน", "90 วัน"
  dueDate     DateTime  @db.Date
  score       Decimal?  @db.Decimal(5, 2)
  strengths   String?   @db.Text
  improvements String?  @db.Text
  reviewerId  String?
  reviewedAt  DateTime?
  status      String    @default("pending") // pending|done|skipped
  round       HrProbationRound @relation(fields: [roundId], references: [id], onDelete: Cascade)

  @@index([roundId])
  @@map("hr_probation_checkpoints")
}
```

**เพิ่ม relation ใน `Employee`:** `probationRounds HrProbationRound[]`, `equipmentIssuances HrEquipmentIssuance[]`, `hireRecord HrHireRecord?` และลบ `probationReviews HrProbationReview[]`

---

## 4. Business Logic สำคัญ (Service Layer)

### 4.1 Transition Rules
- **Manpower approve ครบ chain** → `status: budget_pending` (เปิดกรอกงบ)
- **Budget approve ครบ** → `budget_approved` → กดเปิดรับสมัคร → `recruiting`
- **Hire confirm (offer accepted):** ใน `prisma.$transaction()` เดียว:
  1. สร้าง `Employee` (status `PENDING_START`, ใช้ EmployeeCodeConfig gen code)
  2. ผูก `hireRecord.employeeId`
  3. สร้าง `HrEquipmentIssuance` จาก equipment request ที่ approved
  4. สร้าง onboarding tasks ผ่าน lifecycle assignment rules เดิม
- **วันเริ่มงาน (check-in วันแรก / HR กดยืนยัน):**
  1. `Employee.status → PROBATION`, set `startDate`
  2. Auto-create `HrProbationRound` (dueDate = startDate + probationDays) + checkpoints 30/60/90
  3. Issuance พร้อมให้เซ็นรับ
- **Probation decide:**
  - `passed` → `Employee.status: ACTIVE` + ปิด manpower request → `completed`
  - `extended` → ปิด round เดิม สร้าง round ใหม่ (`extendedFrom`) ต่อ dueDate
  - `failed` → `Employee.status: TERMINATED` → trigger offboarding + คืนอุปกรณ์ (issuance → `returned`)

### 4.2 Bull Queue Jobs (Redis)
| Job | Trigger | Action |
|---|---|---|
| `interview-reminder` | 24 ชม. + 1 ชม. ก่อนนัด | แจ้ง interviewer + candidate (email/LINE) |
| `start-date-reminder` | 3 วันก่อนวันเริ่มงาน | แจ้ง HR + หัวหน้าแผนก เตรียมของเบิก |
| `probation-checkpoint-due` | daily cron | แจ้ง reviewer checkpoint ที่ใกล้ครบ (7 วันล่วงหน้า) |
| `probation-due` | daily cron | แจ้ง HR round ที่ครบกำหนดแต่ยังไม่ decide |
| `approval-pending-nudge` | daily cron | เตือน approver ที่ค้าง > 2 วัน |

### 4.3 Audit Log (บังคับ)
ทุก transition: create/approve/reject (ทั้ง 3 chains), schedule/reschedule interview, offer, hire, issuance acknowledge, probation decide → `AuditLogService` pattern เดิม

---

## 5. API Endpoints

```
# Module: hr-recruitment (ใหม่)
POST   /api/v1/hr/manpower-requests                    # สร้าง (draft)
GET    /api/v1/hr/manpower-requests?status=&page=
GET    /api/v1/hr/manpower-requests/:id                # รวม timeline ทุก stage
PATCH  /api/v1/hr/manpower-requests/:id
POST   /api/v1/hr/manpower-requests/:id/submit         # draft → pending_approval
POST   /api/v1/hr/manpower-requests/:id/approve        # approve ขั้นปัจจุบัน
POST   /api/v1/hr/manpower-requests/:id/reject
POST   /api/v1/hr/manpower-requests/:id/budget         # กรอก + submit งบ
POST   /api/v1/hr/manpower-requests/:id/budget/approve
POST   /api/v1/hr/manpower-requests/:id/budget/reject
POST   /api/v1/hr/manpower-requests/:id/equipment      # ขออุปกรณ์
POST   /api/v1/hr/equipment-requests/:id/approve
POST   /api/v1/hr/equipment-requests/:id/reject

POST   /api/v1/hr/manpower-requests/:id/candidates
GET    /api/v1/hr/candidates?manpowerRequestId=&status=
PATCH  /api/v1/hr/candidates/:id
POST   /api/v1/hr/candidates/:id/interviews            # นัดสัมภาษณ์
PATCH  /api/v1/hr/interviews/:id                       # reschedule
POST   /api/v1/hr/interviews/:id/result                # บันทึกผล/คะแนน
POST   /api/v1/hr/candidates/:id/offer                 # เสนอจ้าง + วันเริ่มงาน
POST   /api/v1/hr/candidates/:id/hire                  # offer accepted → สร้าง Employee

# Module: hr-onboarding-issuance (ใหม่)
GET    /api/v1/hr/equipment-issuances?employeeId=
POST   /api/v1/hr/equipment-issuances/:id/issue        # HR จ่ายของ
POST   /api/v1/hr/equipment-issuances/:id/acknowledge  # พนักงานเซ็นรับ

# Module: hr-probation (rewrite)
GET    /api/v1/hr/probation-rounds?status=
POST   /api/v1/hr/probation-rounds                     # เปิด manual (พนักงานเดิม)
GET    /api/v1/hr/probation-rounds/:id
POST   /api/v1/hr/probation-rounds/:id/checkpoints/:cpId/review
POST   /api/v1/hr/probation-rounds/:id/decide          # passed|extended|failed
```

ทุก endpoint: JWT Guard + tenant isolation + ValidationPipe + Swagger decorators + per-route throttle (เหมือน housekeeping)

### โครง Module ใหม่

```
src/modules/hr-recruitment/
├── hr-recruitment.module.ts
├── manpower-request.controller.ts / .service.ts / .service.spec.ts
├── candidate.controller.ts / .service.ts / .service.spec.ts
├── interview.controller.ts / .service.ts / .service.spec.ts
├── hire.service.ts / .service.spec.ts
└── dto/ (create-manpower-request.dto.ts, submit-budget.dto.ts,
        create-candidate.dto.ts, schedule-interview.dto.ts,
        make-offer.dto.ts, ...)
src/modules/hr/  (เดิม — rewrite เฉพาะ)
├── hr-probation.service.ts          # rewrite ใช้ HrProbationRound
├── hr-equipment-issuance.service.ts # ใหม่
└── dto/hr-probation.dto.ts          # ใหม่
common/types/approval-chain.ts        # shared + helper buildApprovalChain()
```

---

## 6. Frontend (Next.js — เฟสถัดไป)

```
app/dashboard/hr/
├── recruitment/
│   ├── page.tsx                  # รายการ manpower requests + status board
│   ├── [id]/page.tsx             # Timeline 7 stage + ปุ่ม action ตาม role
│   └── new/page.tsx              # ฟอร์มขอกำลังพล (React Hook Form + Zod)
├── candidates/[id]/page.tsx      # โปรไฟล์ผู้สมัคร + ตารางสัมภาษณ์
├── interviews/page.tsx           # ปฏิทินนัดสัมภาษณ์รวม
└── probation/page.tsx            # rewrite: rounds + checkpoints + decide
lib/stores/useRecruitmentStore.ts  # Zustand
lib/types/recruitment.ts
```

ทุกหน้า full-width ตามกฎ, หน้า detail ใช้ stepper แสดง 7 stage, สถานะ chain แสดงเป็น avatar ลำดับผู้อนุมัติ

---

## 7. Migration Plan (รื้อของเดิม)

1. Migration เดียว: สร้างตารางใหม่ทั้งหมด + migrate ข้อมูล `hr_probation_reviews` เดิม → `hr_probation_rounds` (decision map: pending→active, passed/extended/failed ตรงตัว) แล้ว drop ตารางเดิม
2. ลบ `HrProbationReview` ออกจาก schema + ลบ DTO/endpoint เดิม (`/hr/probation-reviews`)
3. Frontend probation page ชี้ endpoint ใหม่
4. `npm run prisma:migrate` + seed ตัวอย่าง manpower request 1 ชุดเต็ม flow ใน seeder

## 8. Test Plan (80%+)

- **Unit:** ทุก service — transition ถูก/ผิด state, approval chain (approve ข้ามขั้น → 400, reject → resubmit), hire transaction rollback
- **Integration:** flow เต็ม manpower → budget → equipment → candidate → interview → hire → issuance → probation round auto-create → decide passed (ตาม pattern `src/integration` เดิม)
- **E2E:** Supertest ครอบ endpoint หลัก + guard/tenant isolation

## 9. ลำดับการลงโค้ด (แนะนำ)

1. Schema + migration + shared ApprovalChain (วันที่ 1)
2. Manpower + Budget + Equipment approval (วันที่ 1–2)
3. Candidate + Interview + Hire transaction (วันที่ 2–3)
4. Issuance + Probation rewrite + queue jobs (วันที่ 3–4)
5. Integration tests + seeder (วันที่ 4)
6. Frontend (เฟสแยก)

---

## คำถามเปิด (รอนายท่าน confirm)

1. งบ (stage 2) ต้องผูกกับ module `cost-accounting`/budget จริงไหม หรือแค่ตัวเลข+อนุมัติพอ?
2. ของเบิก ต้องผูกกับ `inventory`/procurement module จริง หรือเป็น checklist อิสระ?
3. Candidate portal ให้ผู้สมัครกรอกเองภายหลังไหม (เฟส 2)?
4. Checkpoint default 30/60/90 วัน ปรับได้ต่อ property หรือ fix?
