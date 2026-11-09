# QA — พนักงานหน้างานเข้า Owner Console ได้ (2026-11-09)

## อาการ
สร้างผู้ใช้จาก "ผู้ใช้ & สิทธิ์ → เพิ่มผู้ใช้" ให้สิทธิ์แค่ **POS · พนักงานเสิร์ฟ (waiter)**
แต่บัญชีนั้นล็อกอิน `/login` เข้า Owner Console ได้ และเห็นเมนูเจ้าของครบทุกเมนู

## ต้นเหตุ
| # | จุด | ปัญหา |
|---|-----|-------|
| 1 | API `tenant-users.service.ts → writeGrants()` | `main` คำนวณจาก `previousSystems.includes('main') \|\| …` → ได้ `main` ครั้งเดียวแล้ว **ไม่มีวันถูกถอด** บัญชีที่เคยถือบทบาทหัวหน้า (หรือสร้างด้วย Auto Mockup ที่ติ๊กทุก Terminal) แล้วถูกลดเหลือ waiter จึงยังมี `main` |
| 2 | API `auth.service.ts → completeLoginWith2FA()` | ไม่ตรวจ `allowedSystems` ซ้ำ — บัญชีที่เปิด 2FA จบการล็อกอิน `main` ได้แม้ `/auth/login` จะปฏิเสธ |
| 3 | Web `middleware.ts` | กันเฉพาะบทบาทจัดซื้อ — บทบาทหน้างานอื่นที่ backend ปล่อยผ่าน เข้า `/dashboard` ได้ทุกหน้า |
| 4 | Tests เดิม | `tenant-users.service.spec.ts` มี 2 เคสที่ **ยืนยันพฤติกรรมบั๊ก** (คาดว่า waiter ยังมี `main`) |

## นโยบาย (ตัดสินแล้ว 2026-11-09)
**Owner Console เป็นของเจ้าของ (tenant_admin) เท่านั้น** — พนักงานทุกระดับ รวมผู้จัดการ Terminal
(hotel_manager, hr_manager, chief_accountant …) ใช้ได้เฉพาะระบบย่อยของตน
เหตุผล: ผู้จัดการที่เข้า Owner Console เห็นเมนูเจ้าของครบ แต่ API ส่วนใหญ่ตอบ
`Access denied … requires one of: [platform_admin, tenant_admin, manager]` (เช่นหน้ารายงานรวม)

## การแก้ไข
### API (`owner-hotel-services-api`)
- `terminal-registry.ts` — เพิ่ม `MAIN_BY_ACCOUNT_ROLES` + `computeAllowedSystems(role, grants)`:
  `main` ได้เฉพาะ `tenant_admin / admin / platform_admin` — ไม่อ้างค่าเดิมอีก
- `terminal-registry.ts` — เพิ่ม `isTerminalAccountRole()` : บทบาทของ Terminal ใด ๆ (ยกเว้น `manager`, `receptionist` ที่ชื่อชนกับบัญชี dashboard รุ่นเก่า)
- `auth.service.ts` — `/auth/login` (main) ปฏิเสธบทบาทของ Terminal **ทุกระดับ** แม้ข้อมูลเก่าจะยังมี `main` ค้าง
- `tenant-users.service.ts` — `writeGrants()` ใช้ `computeAllowedSystems` ทุกครั้ง; merge mode ไม่นับแถวที่ `revokedAt` แล้ว
- `auth.service.ts` — แยก `assertSystemAllowed()` ใช้ร่วมกันทั้ง `login()` และ `completeLoginWith2FA()`
- `stale-main.ts` + `scripts/fix-stale-main-access.ts` (`npm run users:fix-stale-main`) — ถอด `main` ที่ค้างในข้อมูลเดิม (dry-run เป็นค่าเริ่มต้น, `--apply` เพื่อเขียนจริง, แตะเฉพาะ `main`, ไม่แตะเจ้าของ/บัญชี legacy ที่ไม่มีแถว `user_terminal_access`)

### Web (`owner-hotel-services`)
- `lib/utils/terminalOnlyRoles.ts` — บทบาทของ Terminal ทุกระดับ (หน้างาน + ผู้จัดการ) → Terminal ปลายทาง
- `middleware.ts` — บทบาทหน้างานเข้า `/dashboard` → ลบ cookie `hotel-auth-storage` แล้วส่งไป Terminal ของตน; `/login` ขณะล็อกอินอยู่ → ส่งไป Terminal แทน `/dashboard`
- `app/login/page.tsx` — ล็อกอินสำเร็จแต่เป็นบทบาทหน้างาน → logout ทันที + แจ้งให้ไปใช้ Terminal
- `jest.setup.js` — ข้าม `window.matchMedia` เมื่อเป็น `@jest-environment node` (ให้เทส middleware ได้)

## ผลทดสอบ
| Repo | ชุดทดสอบ | ผล |
|------|----------|----|
| API | `tenant-users/*`, `hotel-terminal-users/*`, `auth.service.system-gate.spec.ts`, `auth.service.spec.ts`, `system.guard.spec.ts` | **ผ่านทั้งหมด** — ดู `2026-11-09-owner-console-access.backend.txt` |
| Web | `__tests__/unit/auth/ownerConsoleAccess.test.ts` | **44/44 ผ่าน** — ดู `owner-hotel-services/docs/qa/2026-11-09-owner-console-access.frontend.txt` |
| Web | ทั้ง repo (`npx jest`) | 3493/3495 ผ่าน — 2 เคสที่ตกไม่เกี่ยวกับงานนี้ (`auth.e2e` ต้องต่อ API จริง, `fnb-pages` แท็บ "คลังต้นทาง") |
| API | ทั้ง repo | รันใน Linux VM ไม่ครบ: หลายชุดตกเพราะ `bcrypt` native (`invalid ELF header` — binary ของ macOS) — **ต้องรัน `npm test` บน Mac อีกรอบ** |

### เคส regression ที่ล็อกไว้แล้ว
- บัญชีใหม่ POS·waiter → `allowedSystems = ["pos"]`
- หัวหน้าถูกลดเหลือ waiter → `main` ถูกถอด
- บทบาทหน้างาน 8 แบบ (front_desk, housekeeper, chef, cashier, buyer, inventory_clerk, accountant, hr_officer) → ไม่มี `main`
- ผู้จัดการ Terminal 6 แบบ → ได้เฉพาะ Terminal ของตน ไม่มี `main`
- `/auth/login` ปฏิเสธ hotel_manager แม้ข้อมูลยังมี `main`; `/auth/hotel-terminal/login` ยังเข้าได้
- บัญชี dashboard รุ่นเก่า `manager` ยังเข้า Owner Console ได้ (allowedSystems ตัดสิน)
- `/auth/login` (main) ปฏิเสธบัญชี POS-only **ก่อน**ตรวจรหัสผ่าน; POS login ยังใช้ได้
- 2FA ปฏิเสธการจบล็อกอิน `main` ของบัญชี POS-only
- middleware: บทบาท Terminal ทั้ง 29 แบบ (หน้างาน + ผู้จัดการ) ถูกส่งไป Terminal ของตน + cookie ถูกลบ; procurement_manager → /purchasing; เจ้าของ / `manager` รุ่นเก่า / platform admin เข้าได้ตามเดิม

## ขั้นตอนหลัง deploy
1. `npm run users:fix-stale-main` (ดูรายการ) → `npm run users:fix-stale-main -- --apply`
2. ทดสอบมือ: สร้าง POS·waiter และ Hotel·hotel_manager → ล็อกอิน `/login` ต้องขึ้น "บัญชีนี้ใช้ได้เฉพาะระบบย่อย (Terminal)"; ล็อกอินที่ `/pos` / `/hotel-terminal` ต้องเข้าได้

## ค้างไว้ (รอตัดสินใจ)
- บทบาท POS `manager` (ผู้จัดการร้าน) ชื่อชนกับ `manager` ของ dashboard รุ่นเก่า จึงยังไม่ถูกกันจาก Owner Console — ควรเปลี่ยนชื่อบทบาท POS เป็น `restaurant_manager`
- โมดูลเก่า `accounting-users` / seeder ยังเขียน `main` ให้พนักงานบัญชี/HR — ถูกกันที่ `/auth/login` + เว็บแล้ว แต่ข้อมูลยังมี `main` (สคริปต์ fix-stale-main ล้างเฉพาะบัญชีที่มีแถว user_terminal_access)
- "บังคับเปลี่ยนรหัสผ่านครั้งแรก" ใน wizard ไม่ถูกส่งไป API และ DTO ยังไม่มี field นี้
- เมนู sidebar ยังไม่กรองตามบทบาท (ไม่จำเป็นแล้วสำหรับบทบาทหน้างาน เพราะเข้า `/dashboard` ไม่ได้)
