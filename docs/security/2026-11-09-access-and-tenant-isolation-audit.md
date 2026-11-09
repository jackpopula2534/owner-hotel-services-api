# Security audit — การกั้นสิทธิ์ระบบ & การแยกข้อมูลระหว่าง tenant (2026-11-09)

ขอบเขต: Owner Console vs Terminal, guard ระดับ global, JWT, Prisma tenant scope, raw SQL,
endpoint สาธารณะ, การจัดการผู้ใช้/สลับ tenant — ตรวจจากซอร์ส (static) + unit test
ไม่ได้ยิง API จริงกับฐานข้อมูล

## สรุป
| ระดับ | # | สถานะ |
|---|---|---|
| Critical | 2 | **แก้แล้ว** + มีเทสต์ |
| High | 3 | **H1 แก้แล้วสำหรับ Hotel Terminal** (Terminal อื่นอยู่ในโหมด report), H2–H3 รอ |
| Medium | 5 | **M1–M3 แก้แล้ว**, M4–M5 รอแก้ |
| Low | 4 | รอแก้ |

---

## Critical (แก้แล้ว)

### C1 — endpoint ของ platform admin เปิดให้ผู้ใช้ทุกคนที่ล็อกอิน
มีแค่ `JwtAuthGuard` ไม่มี `PlatformAdminGuard` → พนักงานของ tenant ไหนก็ได้ (รวม token จาก
Hotel/HR/Accounting Terminal; ยกเว้น POS ที่ SystemGuard กันไว้) เรียกได้:

| Endpoint | ผลกระทบ |
|---|---|
| `POST /admin/impersonation` | ออก JWT "impersonation" เอง (ดู C2) |
| `GET /admin/impersonation` | ดูประวัติ impersonation |
| `POST/PATCH /coupons/admin…` | สร้างคูปองลด 100% ให้ตัวเอง |
| `POST/PATCH /announcements/admin…` | ประกาศถึง **ทุก tenant** (phishing) |
| `/admin/analytics/*` | MRR / churn / LTV ของแพลตฟอร์ม |
| `/admin/queues/*` | retry / ลบ job ในคิวของทั้งระบบ |
| `/admin/dunning/*` | สั่งทวงหนี้ / run-now |
| `/admin/database/*` | slow queries / clear metrics |
| `GET /data-export/admin` | รายการ export (+ download URL) |

**แก้:** ใส่ `PlatformAdminGuard` (class-level 4 controller, method-level ที่เหลือ)
ยกเว้น `DELETE /admin/impersonation/:id` — banner ใช้ token impersonation ยิง และ service ตรวจผู้เริ่ม session อยู่แล้ว
**เทสต์:** `src/common/guards/platform-admin-routes.spec.ts` ตรึง guard ทุก route

### C2 — token ที่ไม่มี `tenantId` วิ่งโดยไม่มี tenant scope
`JwtStrategy` เอา `role` / `tenantId` จาก payload ตรง ๆ token impersonation ใส่ `tenant_id` (snake) ไม่ใช่
`tenantId` → `req.user.tenantId = undefined` → `TenantContext` ว่าง → Prisma tenant-scope ไม่ทำงาน
และ service ที่ใช้ `where: { tenantId: user.tenantId }` โดยไม่ throw เมื่อว่าง = อ่าน **ทุก tenant**
(service ส่วนใหญ่มี `if (!tenantId) throw` — แต่ไม่ครบทุกตัว)
**แก้:** `JwtStrategy` ปฏิเสธ token ที่ `tenantId` ไม่ตรงกับ `users.tenantId` ในฐาน (รวมกรณีไม่มี)
— การสลับ tenant เขียน `users.tenantId` ใหม่อยู่แล้ว จึงไม่กระทบ flow ปกติ
**เทสต์:** 4 เคสใหม่ใน `jwt.strategy.spec.ts`
หมายเหตุ: ฟีเจอร์ impersonation ของ admin จริงใช้ไม่ได้อยู่แล้ว (sub = admin id ซึ่งไม่อยู่ในตาราง users) — ต้องออกแบบใหม่ถ้าจะใช้

---

## High (ยังไม่แก้ — ต้องตัดสินใจ)

### H1 — ✅ แก้แล้ว (ยกเว้น Camp ที่ยังอยู่ report mode) — SystemGuard บังคับใช้เฉพาะ POS → การกั้น Owner Console เป็นแค่ UI สำหรับ Terminal อื่น
`ENFORCED_SYSTEMS = ['pos']` token จาก hotel-terminal / hr / accounting / procurement / warehouse ผ่านทุก endpoint
ที่ `@Roles` ยอม และมี **~470 route ใน 73 controller ที่ไม่มี role check เลย** (เช่น payment-accounts,
ar-invoices, chart-of-accounts, staff, purchase-orders, cost-*, tax-*) → front_desk / hr_viewer ยิง API อ่านบัญชีธนาคาร
ใบแจ้งหนี้ ผังบัญชี ฯลฯ ของ tenant ตัวเองได้
**แนวทาง:** ไล่ endpoint ที่ frontend ของแต่ละ Terminal เรียก → ติด `@AllowSystems(...)` → เพิ่มชื่อระบบลง
`ENFORCED_SYSTEMS` ทีละระบบ (เริ่ม `hotel-terminal`) + เพิ่ม `@Roles` ให้ controller การเงิน/บัญชี

### H2 — สลับ tenant แล้วได้ role ของ tenant เดิมติดไป
`POST /tenants/switch` ออก token ด้วย `role: user.role` (role ใน tenant ปัจจุบัน) ไม่สน `UserTenant.role`
→ เจ้าของร้าน A ที่ถูกเชิญเข้า B เป็น "member" สลับไปแล้วได้ `tenant_admin` ใน B
**แนวทาง:** map `UserTenant.role` (owner/admin/member) → role ของระบบตอนออก token

### H3 — frontend middleware ตัดสินจาก cookie ที่ผู้ใช้แก้เองได้
`role` / `isPlatformAdmin` ใน cookie `hotel-auth-storage` แก้ได้ → การ redirect เป็น UX เท่านั้น
ความปลอดภัยจริงต้องอยู่ที่ API (ผูกกับ H1)

---

## Medium

| # | ปัญหา | ที่ | แนวทาง |
|---|---|---|---|
| M1 | Public guest lookup: พิมพ์ 2 ตัวอักษร → ได้ชื่อ-นามสกุล + guestId + VIP ของแขก (PDPA) และส่ง guestId ตอนสั่งอาหารผ่าน QR → ได้ส่วนลดแขก | `POST /public/restaurants/:id/guest-lookup`, `createPublicOrder` | ต้องตรงทั้งชื่อ+เลขห้องที่เช็คอินอยู่ / ไม่คืน id / ผูกกับ booking ที่ active |
| M2 | สมัครฟรีกำหนด `trialDays` เองได้ | `POST /onboarding/register` | ตัด `trialDays` จาก body ใช้ค่าจาก plan |
| M3 | diagnostic คืน tenantId 5 อันดับ + จำนวนพนักงานของ **tenant อื่น** (raw SQL ไม่ scope) และ fallback ไปอ่าน tenant พี่น้อง | `hotel-terminal-users.service.ts` `listImportableEmployees` / departments | ลบ diagnostic + fallback ทิ้ง |
| M4 | 7 model มีคอลัมน์ tenant แต่ไม่อยู่ใน `TENANT_SCOPED_MODELS` (HrCompensationChange = เงินเดือน, ProductChangeRequest, CampOpsTask/Event, Hotel/CampMap3dVersion) — ตอนนี้ service กรองเอง แต่ไม่มีตาข่ายสำรอง | `tenant-scoped-models.ts` | รัน `scripts/regenerate-tenant-scoped-models.sh` + เพิ่มเทสต์เทียบ schema |
| M5 | บทบาท POS `manager` ชนกับ `manager` ของ dashboard รุ่นเก่า (อยู่ใน ADMIN_ROLES) — ผู้จัดการร้านที่สร้างด้วยโมดูลเก่าได้ `["main","pos"]` → เข้า Owner Console + จัดการผู้ใช้ทั้ง tenant | auth `createPosUser`, tenant-users `ADMIN_ROLES` | เปลี่ยนชื่อบทบาท POS เป็น `restaurant_manager` + migrate |

## Low
| # | ปัญหา |
|---|---|
| L1 | `POST /reports/export*` ไม่มี auth — แปลงข้อมูลที่ client ส่งมา (ไม่รั่ว แต่ใช้ CPU ฟรี) |
| L2 | `GET /onboarding/tenant/:tenantId/trial-status` ไม่มี auth |
| L3 | `POST /tenants/invite` บอกได้ว่าอีเมลมีในระบบหรือไม่ (ข้าม tenant) |
| L4 | `/i18n/translate*` ไม่มี auth (ยังไม่ได้ตรวจว่าเรียก AI/แปลภายนอกหรือไม่) |

## สิ่งที่ตรวจแล้ว "โอเค"
- Prisma tenant-scope middleware: ฉีด `tenantId` ทุก read/write, throw เมื่อ tenantId ไม่ตรง, ห้าม `findUnique`
- TenantGuard: บล็อก `:tenantId` / `?tenantId=` ข้าม tenant
- raw SQL อื่น ๆ ใช้ parameter binding (ไม่มี SQL injection ที่พบ)
- `@SkipTenantScope` ใช้แค่ 2 controller ที่มี `PlatformAdminGuard`
- token ประเภท 2fa_pending / launch ถูก JwtStrategy ปฏิเสธ; launch token ใช้ครั้งเดียว
- การเชิญผู้ใช้ตรวจว่าผู้เชิญเป็น owner/admin ของ tenant นั้น
- PaymentAccount (ไม่มี tenantId) — controller ตรวจ property ↔ tenant ทุก path

## ผลทดสอบ
`platform-admin-routes.spec.ts`, `jwt.strategy.spec.ts`, `auth.service.system-gate.spec.ts`, `tenant-users/*`, `common/guards/*`
→ **145 ผ่าน**, 2 ตก (`addon.guard.spec.ts` — ตกอยู่ก่อนแล้ว ไฟล์ไม่ได้แตะ, แก้ล่าสุด 2026-07-16)


---

## รอบแก้ M1–M3 (2026-11-09)

### M3 — ข้อมูลพนักงานข้าม tenant ใน "นำเข้าจาก HR"
- `hotel-terminal-users.service.ts`: ลบ fallback ไป tenant พี่น้อง (UserTenant + raw SQL) ทั้งใน
  `listImportableEmployees` และ `listImportableEmployeeDepartments` และลบ `meta.diagnostic` ที่คืน
  จำนวนพนักงานทั้งระบบ + tenantId 5 อันดับ — เหลือ diagnostic เดียวคือ `no_tenant_in_token` (ไม่มีข้อมูล tenant อื่น)
- เว็บ (`/dashboard/hotel-users`) ไม่ต้องแก้ — เมื่อไม่มี diagnostic จะแสดงข้อความ "ยังไม่มีพนักงานในระบบ HR" ตามเดิม
- เทสต์: แทน 2 เคสเดิมที่ล็อกพฤติกรรมรั่ว → "never falls back to another tenant", "an empty list carries no cross-tenant diagnostic"

### M2 — สมัครทดลองใช้กำหนด trialDays เอง
- `onboarding.controller.ts`: ไม่อ่าน `trialDays` จาก body แล้ว ใช้ `ONBOARDING_TRIAL_DAYS = 14`
  (platform admin ยังต่ออายุได้ผ่าน admin-approval) · ตรวจแล้ว `status` / `trialEndsAt` ใน DTO ถูกเขียนทับฝั่ง server
- เว็บ: ตัด `trialDays` ออกจาก type ของ `onboarding.register`
- เทสต์: "ignores a client-supplied trial length"

### M1 — ค้นหาแขกแบบสาธารณะ (QR สั่งอาหาร)
- API `POST /public/restaurants/:id/guest-lookup` รับ `{ firstName, lastName, phoneLast4 }`
  ชื่อต้องตรงทั้งคำ (ไม่ใช้ `contains`) + 4 หลักท้ายเบอร์ต้องตรง · ถ้าไม่เจอหรือเจอซ้ำ 2 คน → `{ matched: false }` เหมือนกัน
- ไม่คืน `guest.id` แล้ว → คืน `guestToken` (HMAC-SHA256, key แยกจาก JWT_SECRET, ผูก restaurant + tenant, อายุ 2 ชม.)
- `POST …/tables/:tableId/orders` รับเฉพาะ `guestToken` — `guestId` ดิบถูกเพิกเฉย (ไม่ได้ส่วนลด) · token ปลอม/หมดอายุ → 400
- เว็บ `app/restaurant/order/[tableId]`: ช่อง "ชื่อ - นามสกุล" + "เบอร์โทร 4 หลักท้าย" และส่ง `guestToken`
- เทสต์: `qr-guest.spec.ts` (token round-trip / ปลอม / หมดอายุ / ต่างร้าน, exact match, ไม่คืน id, guestId ดิบถูกเพิกเฉย)
  + `__tests__/api/qrGuestLookup.test.ts` ฝั่งเว็บ
- ⚠️ ผลกระทบ: แขกที่ไม่มีเบอร์โทรในระบบจะยืนยันตัวไม่ได้ (สั่งอาหารได้ปกติ แค่ไม่ได้ส่วนลดแขก)

### ผลทดสอบรอบนี้
| Repo | ชุด | ผล |
|---|---|---|
| API | `hotel-terminal-users/*`, `restaurant/order/*`, `onboarding/*` | 107/107 ผ่าน |
| Web | `__tests__/api/qrGuestLookup.test.ts` + ทุกเทสต์ที่ชื่อมี `restaurant` | 176/176 ผ่าน |

### เจอเพิ่มระหว่างแก้ (ยังไม่แก้)
- **L5** `GET /public/restaurants/orders/:orderNumber/status` ไม่มี auth และเลขออเดอร์เรียงลำดับ (`ORD-YYYYMMDD-0001`)
  → เดาเลขแล้วดูรายการอาหาร/สถานะออเดอร์ของร้านไหนก็ได้ · แนวทาง: คืน tracking token แบบสุ่มตอนสร้างออเดอร์ แล้วใช้ token นั้นติดตามแทนเลขออเดอร์


---

## รอบแก้ H1 — Hotel Terminal (2026-11-09)

### กลไกใหม่ใน `SystemGuard`
- `ENFORCED_SYSTEMS` (default `pos, hotel-terminal`) = default deny: token เข้าได้เฉพาะ endpoint ที่ติด `@AllowSystems(...)`
- `REPORT_SYSTEMS` (default `hr, accounting, procurement, warehouse`) = ยังปล่อยผ่าน แต่ log ทุก endpoint นอก allow-list
  (`[SystemGuard:report] …` ใน console + `logs/system-guard-report.jsonl` นอก production) เพื่อไล่ allow-list ก่อนเปิดบังคับ
- ปรับแต่งต่อ environment: `SYSTEM_GUARD_ENFORCE=pos,hotel-terminal` / `SYSTEM_GUARD_REPORT=hr,…`
- รวม `@AllowSystems` ระดับ class + handler (`getAllAndMerge`) — handler ที่ติด `'pos'` ใน class ที่ติด `'hotel-terminal'` เปิดให้ทั้งคู่

### Allow-list ของ Hotel Terminal
class: bookings (+folio), guests, rooms, housekeeping, maintenance, properties, hotel-map3d, hotel-terminal/users,
messaging, website-admin, channels, payment-accounts, payment-settings, promptpay, notifications, users (me/profile),
sub-systems, dashboard, addons, analytics
handler: `GET /staff` (roster), `GET /tenants/hotels`, `GET /tenants/hotels/:id`
ที่ไม่เปิด: HR (นำเข้าพนักงานจาก HR — role guard ไม่ให้ hotel_manager อยู่แล้ว; เจ้าของใช้ผ่าน SSO ซึ่งเป็น token `main`)

### วิธียืนยัน
1. static: กราฟ import จาก `app/hotel-terminal` (resolve barrel ตามชื่อที่ import จริง) → รายการ API ที่เป็นไปได้
2. report mode + เดินทุกหน้า 18 หน้าในฐานะ hotel_manager → log นอก allow-list มีแค่ `GET /staff`, `GET /tenants/hotels` → เพิ่ม
3. เปิด enforce แล้วเดินซ้ำ 18 หน้า → **API 115 ครั้ง 200 ทั้งหมด ไม่มี 4xx/5xx**
4. probe ด้วย token Hotel Terminal:

| Endpoint | ก่อน | หลัง |
|---|---|---|
| `GET /accounting/chart-of-accounts` | 200 | 403 WRONG_SYSTEM_CONTEXT |
| `GET /accounting/ar-invoices` | 200 | 403 |
| `GET /accounting/bank-statements` | 200 | 403 |
| `GET /inventory/purchase-orders` | 200 | 403 |
| `GET /cost-accounting/cost-budgets` | 200 | 403 |
| `GET /tenant-users` / `GET /hr` / `POST /staff` | 403 (role) / 200 | 403 |
| `GET /rooms`, `/bookings`, `/guests`, `/staff`, `/tenants/hotels`, `/payment-accounts` | 200 | 200 (ตั้งใจ) |

### เทสต์
- `system.guard.spec.ts` (20) — enforce hotel-terminal, report mode, merge class+handler
- `hotel-terminal-allowlist.spec.ts` (12) — ตรึง: bookings/rooms/guests/housekeeping เข้าได้ทั้งหมด;
  chart-of-accounts / ar-invoices / tenant-users / purchase-orders / hr / cost-budgets เข้าไม่ได้เลย; staff เปิดแค่ list; tenants เปิดแค่ 2 read

### ⚠️ Regression จากรอบก่อนที่เจอและแก้แล้ว
Camp Terminal / Retail / CRM Terminal **ไม่มีหน้า login ของตัวเอง** — ใช้ session หลัก (`/login`).
การปิด `main` ให้บทบาท Terminal ทำให้ `camp_*`, `retail_*`, `crm_*` login ไม่ได้ → แก้:
- API: `MAIN_SESSION_TERMINALS = camp-terminal, retail, crm` ได้ `main` และไม่นับเป็น terminal-only
- Web: `MAIN_SESSION_ROLE_HOME` — login แล้วพาไป Terminal ของตน, เข้า `/dashboard` → redirect (ไม่ลบ session)
- เทสต์ทั้งสองฝั่ง

### ~~ยังเหลือ (H1 ต่อ)~~ → ปิดในรอบถัดไป ดูด้านล่าง

## รอบปิด H1 — HR / Accounting / Procurement / Warehouse, Camp / Retail / CRM, @Roles ใน Hotel Terminal (2026-11-09)

### H1.1 — HR / Accounting / Procurement / Warehouse → ENFORCE
- เดินทุกหน้าของแต่ละ Terminal ในเบราว์เซอร์แบบ report mode แล้วอ่าน `logs/system-guard-report.jsonl`
- ติด `@AllowSystems` ให้ 94 controller ของโดเมนนั้น ๆ รวมถึง class ที่สองในไฟล์เดียวกัน
  (HrProbation, HrAnalytics, Interview, HireRecord, EquipmentRequest, ItemLots, InventoryReports, RetailMembers)
- ย้ายทั้ง 4 ระบบเข้า `ENFORCED_SYSTEMS` แล้วเดินซ้ำ:

| ระบบ | ผลการเดินซ้ำ |
|---|---|
| HR | 107 call → 200 ทั้งหมด |
| Accounting | 130 call → 0 fail |
| Procurement | 294 request → 0 4xx |
| Warehouse | 237 request → 0 4xx |

- probe: token ของ Hotel Terminal ยิง accounting / purchase-orders / cost / tenant-users / hr / admin → 403 `WRONG_SYSTEM_CONTEXT`

### H1.2 — Camp / Retail / CRM: main session แบบมี scope (claim `terminals`)
ระบบเหล่านี้ไม่มี login ของตัวเอง เลยไม่ได้แยก systemContext ใหม่ แต่ให้ token `main` ของพนักงานพกรายชื่อ Terminal ที่ใช้ได้ไปด้วย
- `mainSessionScope(role, allowedSystems)` (terminal-registry) คืนค่า Terminal ของ role ∪ สิทธิ์ที่ได้รับ
  ใน camp-terminal / retail / crm สำหรับ owner / admin คืน `null` คือไม่ถูกจำกัด
- `generateTokens` ใส่ `terminals` ทุกครั้งที่ออก token `main` ทั้งตอน login, refresh, 2FA และ launch
  refresh จึงขยาย scope กลับเป็น main เต็มไม่ได้ ถ้าอ่าน scope จาก DB ไม่ได้ จะ **fail closed** คือ sign-in ล้ม
- `assertSystemAllowed`: บทบาท Terminal (เช่น hotel_manager) เข้า main ได้**เฉพาะ**เมื่อมี scope
  ตัวอย่างคือ hotel_manager ที่ได้สิทธิ์ CRM เพิ่ม ส่วน waiter ยังโดน `AUTH_NOT_AUTHORIZED_MAIN` เหมือนเดิม
- `SystemGuard`: token `main` ที่มี `terminals` จะถูกจำกัดไว้ที่ endpoint ที่ติด `@AllowSystems` ของ Terminal เหล่านั้น
- Tag: camp → camp-terminal / crm, loyalty, reviews, guests → crm
  retail-sales/products/promotions, items, categories, warehouses, qr, procurement-stock → retail
  shared (users, notifications, properties, addons, sub-systems) → ทุก Terminal
  `GET /subscriptions/tenant/:tenantId` → crm, retail, camp-terminal (เจอตอนเปิดบังคับ; TenantGuard ยังกันข้าม tenant)
- Frontend: cookie เก็บ `terminals`; middleware ส่ง session ที่มี scope จาก /dashboard ไป Terminal ของตัวเอง
  โดย**ไม่**ลบ session; หน้า login ทำแบบเดียวกัน; `ROUTE_SYSTEM` รู้จัก /camp-terminal, /retail, /crm-terminal
- `GET /loyalty/points` (dashboard CRM เรียก) เพิ่ม crm_manager / crm_agent เพราะก่อนหน้านี้โดน RolesGuard 403 อยู่แล้ว (bug เดิม)
- **ผลในเบราว์เซอร์** (สมศักดิ์ ให้สิทธิ์ crm_manager + retail_manager ชั่วคราว):
  - login ได้ token `main` ที่ `terminals: [crm, retail]`
  - endpoint ทั้งหมดที่หน้า CRM + Retail POS เรียก **28/28 ผ่าน**
  - POST ของ retail ผ่าน guard (ได้ 400 จาก validation)
  - นอก scope: chart-of-accounts, tenant-users, bookings, `GET /subscriptions` → 403 `WRONG_SYSTEM_CONTEXT`
  - subscription ของ tenant อื่น → 403 `CROSS_TENANT_ACCESS`
  - owner เดินหน้า CRM ซ้ำ: 60 call, 0 error
- ถอดสิทธิ์ชั่วคราวแล้ว: สมศักดิ์กลับมามีแค่ Hotel Management Terminal และ login main → 401 `AUTH_NOT_AUTHORIZED_MAIN`
- **Camp Terminal ยังอยู่ REPORT** เพราะในข้อมูล QA ไม่มี tenant ที่มี product CAMP ให้เดินหน้าได้
  ต้องเดิน /camp-terminal ด้วย tenant ที่มี CAMP ก่อน แล้วค่อยย้ายเข้า ENFORCE (`SYSTEM_GUARD_ENFORCE` / แก้ default)

### H1.3 — การเขียนใน Hotel Terminal จำกัดเฉพาะผู้จัดการ
- `MANAGER_WRITE_ROLES` = platform_admin, admin, tenant_admin, manager, hotel_manager, camp_manager
- payment-accounts: 5 write handler; messaging integrations / auto-reply-templates: 7 write handler
  (เพิ่ม `JwtAuthGuard + RolesGuard`)
- การอ่านยังเปิดให้ทุกบทบาทของ Terminal
- Frontend: เมนู "ช่องทาง" ใน Hotel Terminal ใช้ perm `property.manage`

### เทสต์
ดู `docs/security/2026-11-09-h1-complete-tests.txt`
- ฝั่ง API: 15 suite ผ่านทั้งหมด รวม spec ใหม่ `main-session-scope` และ test เพิ่มใน `system.guard` / `system-gate`
- ฝั่ง frontend: 62/62
- ที่ยังล้ม (ไม่เกี่ยวกับงานนี้): addon.guard, data-retention, launch-roles (bcrypt ใน VM)

### ยังเหลือ
- Camp Terminal → ENFORCE (ต้องมี tenant CAMP)
- H2, H3, M4, M5, L1–L5 ตามรายการด้านบน
