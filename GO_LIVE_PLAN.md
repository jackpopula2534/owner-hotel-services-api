# StaySync — Go-Live Plan (6 สัปดาห์, Solo)

> สร้างเมื่อ: 2026-05-17
> Target launch: 2026-06-28 (~6 สัปดาห์)
> Mode: Solo developer
> Payment: Manual PromptPay + Ops SLA
> Launch scale: Beta 5-10 โรงแรม
> ฐานอ้างอิง: Production Readiness Audit 2026-05-17

---

## 🎯 Goal & Success Criteria

**Goal:** เปิดให้ลูกค้า beta 5-10 โรงแรม subscribe เข้ามาเอง (self-serve sign-up + admin verify payment) ภายใน 6 สัปดาห์ โดยไม่มี data breach risk

**Definition of Done (ทุก sprint ต้องผ่าน):**

- ทุก task มี acceptance test ที่รันได้
- TypeScript build = 0 errors
- npm audit = 0 high/critical
- ไม่มี secrets ใน git history
- ทุก critical path มี monitoring + alert
- มี rollback path สำหรับทุก deploy

---

## 📅 Sprint Plan

### Week 1 (May 17–23) — 🔥 Security Blockers

**Why first:** JWT key หลุดใน git = ทุก beta user หลังจากนี้เสี่ยงโดน impersonation ตั้งแต่วันแรก ต้องปิดก่อนทำอย่างอื่น

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 1.1 | Rotate `JWT_SECRET` (generate ใหม่ด้วย `openssl rand -hex 64`) | 30 min | `.env` ใหม่ deploy แล้ว, force logout ทุก user (clear sessions) |
| 1.2 | Rotate Firebase service account key ใน Firebase Console | 30 min | Key เก่า revoked, FE/BE ใช้ key ใหม่ได้ |
| 1.3 | แทน `.env.example` ทุก secret ด้วย placeholder `<replace-me>` | 1 hr | grep ค่า `952b9e6b` ต้องไม่เจอใน HEAD |
| 1.4 | ลบ secrets จาก git history ด้วย `git filter-repo --invert-paths --path .env.example` แล้ว commit ใหม่เป็น clean version | 2 hr | `git log --all -p \| grep "JWT_SECRET=952"` empty |
| 1.5 | Force-push ที่ remote + แจ้ง teammate ให้ re-clone (ถ้ามี) | 30 min | Remote main ไม่มี history ที่มี secret แล้ว |
| 1.6 | เพิ่ม pre-commit hook ด้วย `gitleaks` ป้องกัน secret หลุดอีก | 1 hr | `git commit` ที่มี string คล้าย JWT/private key ถูก block |
| 1.7 | เพิ่ม env validation ใน `src/config/env.validation.ts` ให้ throw ถ้า `JWT_SECRET` ขึ้นต้น `952b9e6b` (sentinel) | 30 min | server boot ด้วย old secret = crash with clear message |
| 1.8 | Document procedure ใน `INCIDENT_RESPONSE.md` หัวข้อ "Secret Rotation" | 1 hr | ทำตามทีหลังได้โดยไม่ต้องนึก |

**Acceptance:** หลัง deploy week 1 — ลอง `curl` API ด้วย JWT เก่า → 401, ด้วย JWT ใหม่ → 200

**Commands ที่ใช้:**

```bash
# Generate new JWT secret
openssl rand -hex 64

# Install gitleaks
brew install gitleaks
gitleaks detect --no-banner

# Install git-filter-repo
brew install git-filter-repo
git filter-repo --replace-text <(echo "JWT_SECRET=952b9e6b...==>JWT_SECRET=<replaced>")
```

---

### Week 2 (May 24–30) — 🛡️ Multi-Tenant Enforcement Layer

**Why critical:** ปัจจุบัน 325 prisma calls หา record by `id` โดยไม่มี `tenantId` filter — UUID ที่หลุดผ่าน log/email/screenshot = อ่านข้าม tenant ได้ทันที กับ beta 10 โรงแรมที่รู้จักกันเอง = ความเสี่ยงสูงมาก

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 2.1 | Register `TenantGuard` เป็น `APP_GUARD` global ใน `app.module.ts` (เพิ่ม route exclusion สำหรับ public endpoints) | 2 hr | Cross-tenant `curl` test ได้ 403 ทุก tenant-scoped controller |
| 2.2 | เขียน Prisma Client extension ที่ auto-inject `tenantId` filter จาก AsyncLocalStorage (request context) สำหรับ tenant-scoped models | 1 day | Test: query Booking โดยไม่ระบุ tenantId → query log ต้องมี `WHERE tenantId = ?` |
| 2.3 | สร้าง `TenantContextMiddleware` ที่ set AsyncLocalStorage จาก JWT | 4 hr | Unit test middleware ผ่าน |
| 2.4 | List tenant-scoped models (จาก schema.prisma ที่มี `tenantId` field) — ประมาณ 40-50 models | 2 hr | List file `docs/tenant-scoped-models.md` |
| 2.5 | Refactor critical risk paths first: Bookings, Restaurant Orders, Staff, Guests, Properties, Rooms | 2 days | Integration test cross-tenant ผ่านทุก path |
| 2.6 | เพิ่ม integration test suite `__tests__/integration/cross-tenant.spec.ts` ที่ลอง access ข้าม tenant ทุก endpoint | 4 hr | Test ผ่านครบ |
| 2.7 | Document opt-out pattern สำหรับ platform-admin queries (BankAccount, Plan) — ใช้ `@SkipTenantScope()` decorator | 2 hr | README ใน common/decorators |

**Acceptance:** เปิด 2 tenants พร้อมกัน (Postman environment 2 ชุด) ลองทุก endpoint หลัก → ไม่มี endpoint ไหนเห็นข้อมูลอีก tenant

**Trade-off note:** Prisma extension จะเพิ่ม overhead ~1-2ms/query (acceptable ที่ beta scale) — เร็วกว่ามาทำตอน scale ใหญ่แล้วเขียนใหม่ทั้งระบบ

---

### Week 3 (May 31–Jun 6) — 🔐 Auth Hardening + Code Quality Cleanup

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 3.1 | เพิ่ม `failedLoginAttempts` + `lockedUntil` columns ใน `User` + migration | 2 hr | Migration deployed, default 0 / null |
| 3.2 | Logic lockout ใน `AuthService.login`: 5 fails → lock 15 min (exponential ที่ 10/20/30 fails) | 4 hr | E2E test brute force 6 ครั้ง = 423 Locked |
| 3.3 | Password policy: ยก `@MinLength(8)` + regex ที่บังคับ uppercase + digit + symbol ใน `register.dto.ts`, `password-reset.dto.ts` | 2 hr | Validation test ผ่าน |
| 3.4 | เพิ่ม `helmet` middleware ใน `main.ts` (CSP, HSTS, X-Frame-Options) — match กับ FE middleware | 1 hr | `curl -I` ต้องเห็น security headers ครบ |
| 3.5 | Fix TS errors 3 ที่ใน `src/data-export/*.spec.ts` — export `DATA_EXPORT_QUEUE`, `DATA_EXPORT_JOBS` จาก processor | 30 min | `npx tsc --noEmit` = 0 errors |
| 3.6 | Fix `auth.service.spec.ts` mock — เพิ่ม `prisma.property.findFirst` ใน mock factory | 1 hr | `npm test -- auth.service.spec` ผ่าน |
| 3.7 | รัน `npm test` ทั้ง suite — fix tests ที่ fail | 1 day | Pass rate ≥ 95% |
| 3.8 | เพิ่ม `@nestjs/throttler` per-route limit ที่ password-reset (3/hour ต่อ email — ไม่ใช่แค่ IP) | 2 hr | Test ผ่าน |

**Acceptance:** Pentest checklist section 2 (Authentication) — pass ครบทุกข้อ

---

### Week 4 (Jun 7–13) — 🚀 Deploy Automation + Observability

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 4.1 | เขียน real deploy script ใน `.github/workflows/deploy-production.yml` (SSH + `docker compose pull && up -d --no-deps api`) | 4 hr | Merge to main → deploy auto |
| 4.2 | Zero-downtime: ใช้ `docker compose --scale api=2` + healthcheck แล้วค่อย kill old | 4 hr | Deploy ขณะมี traffic = ไม่ดร็อป |
| 4.3 | Rollback script `scripts/rollback.sh` ที่ revert ไป image tag ก่อนหน้า | 2 hr | Test rollback บน staging |
| 4.4 | Sign-up account Sentry (free tier) + integrate `@sentry/nestjs` + `@sentry/nextjs` | 4 hr | Trigger error → เห็นใน Sentry dashboard |
| 4.5 | Alert rules Sentry: error rate > 1%/5min, slow API > 3s | 1 hr | Alert email/Discord ทำงาน |
| 4.6 | DB backup cron: `mysqldump` รายวัน → S3 (encrypted) + retention 30 วัน | 4 hr | Restore test ผ่าน — DB ใหม่จาก backup ใช้งานได้ |
| 4.7 | ทดสอบ restore จริง 1 ครั้ง (timed) — บันทึก RTO/RPO | 2 hr | RTO < 2 hr, RPO < 24 hr documented |
| 4.8 | Uptime monitoring: BetterStack / Uptime Robot ping `/api/v1/health` ทุก 1 min | 1 hr | Status page public URL พร้อม |

**Acceptance:** Trigger fake error in production → Sentry alert ถึงโทรศัพท์ ภายใน 5 นาที

---

### Week 5 (Jun 14–20) — 📋 Ops Readiness + Manual Payment SOP

**Why important:** Manual payment คือจุดเสี่ยงสุดของ SaaS — ต้องมี SOP ชัด ไม่งั้นโรงแรมโอนแล้วไม่ได้ใช้ระบบ = churn ทันที

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 5.1 | เขียน Manual Payment SOP `docs/ops/payment-verification-sop.md`: 1) ลูกค้า upload slip → 2) Auto Discord alert ถึง ops → 3) ops verify ใน 2 ชั่วโมง (business hours) → 4) approve API → 5) email + push notify ลูกค้า | 4 hr | SOP document complete |
| 5.2 | Discord webhook integration ที่ `PaymentService.create` เมื่อมี slip ใหม่ — แสดง tenant + amount + slip URL | 2 hr | Test: upload slip → Discord channel ปรากฏข้อความ |
| 5.3 | Email/push notify ลูกค้าหลัง approve/reject — มี template ภาษาไทย + en | 4 hr | Trigger test ส่งจริง |
| 5.4 | Dunning workflow (minimal v1): subscription expired → email reminder 1, 3, 7 วัน → suspend day 14 → soft-delete data day 60 | 1 day | Cron job test ผ่าน |
| 5.5 | Subscription cancel flow + data export endpoint (PDPA Article 30) — JSON dump ทุก field ของ tenant นั้น | 4 hr | Test: subscribe → cancel → export → ได้ไฟล์ JSON ครบ |
| 5.6 | กรอกชื่อจริงใน `INCIDENT_RESPONSE.md` (DPO/CTO/Legal + เบอร์โทร 24/7) | 1 hr | Document complete |
| 5.7 | Annual PDPA review `PDPA_ANNUAL_REVIEW.md` ครั้งแรก + sign-off | 2 hr | Document signed |
| 5.8 | Status page setup (BetterStack/Statuspage free) + link ใน footer | 2 hr | Public URL พร้อม |

**Acceptance:** Run end-to-end: ใหม่ลูกค้า → sign up → choose plan → upload slip → ops approve ภายใน 2 ชม. → subscription active → ใช้งานได้

---

### Week 6 (Jun 21–27) — 🎯 Pentest Prep + Beta Launch

| # | Task | ETA | DoD |
|---|------|-----|-----|
| 6.1 | Setup staging environment (subdomain `staging.staysync.io`) — แยก DB จริง | 4 hr | Staging ใช้งานได้ ไม่กระทบ prod |
| 6.2 | Seed staging ด้วย non-PII synthetic data — ใช้ `@faker-js/faker` | 4 hr | Staging มี 3 tenant × 10 booking ครบ |
| 6.3 | Self-pentest ด้วย `PENTEST_CHECKLIST.md` — รันครบทุกหัวข้อ | 1 day | ผ่าน ≥ 90% checks |
| 6.4 | Fix self-pentest findings ที่ระดับ High/Critical | 1-2 days | 0 high findings เหลือ |
| 6.5 | (Optional, ถ้าทันงบ) ส่ง `PENTEST_RFP.md` ให้ firm — ตอบกลับใช้เวลา 2-4 สัปดาห์, อาจ post-launch | 2 hr | RFP ส่งแล้ว |
| 6.6 | Beta onboarding playbook `docs/ops/beta-onboarding.md`: contract template, NDA, support channel, escalation path | 4 hr | Playbook ใช้งานได้จริง |
| 6.7 | Beta agreement (สั้น 2 หน้า) ที่ระบุ: "beta = expect bugs", SLA 95%, data backup ของลูกค้าเอง, exit plan | 4 hr | Legal review เสร็จ |
| 6.8 | Soft launch — invite 2 โรงแรมที่รู้จักก่อน (week 6 day 7) | — | 2 tenants active, 0 critical bugs ใน 48 ชม. |

**Acceptance:** Live with 2 friendly beta tenants, no P0/P1 bugs, all monitoring green

---

## 🚦 Go / No-Go Gates

ก่อนเริ่ม sprint ถัดไปต้องผ่าน gate ของ sprint ก่อนหน้า:

| Gate | Pass Criteria |
|------|---------------|
| W1 → W2 | JWT rotated, git history clean, gitleaks pass |
| W2 → W3 | Cross-tenant integration tests ผ่าน 100% |
| W3 → W4 | TS errors = 0, test pass rate ≥ 95%, brute force test fail at 6th attempt |
| W4 → W5 | Sentry receiving errors, deploy automation tested, restore from backup ผ่าน |
| W5 → W6 | E2E payment flow ผ่าน, ops SOP rehearsed 1 ครั้ง |
| W6 → Launch | Self-pentest ≥ 90% pass, 0 high findings, beta agreement signed |

---

## 🛑 Stop-the-line Triggers

ถ้าเจอสิ่งเหล่านี้ระหว่างทาง — หยุดทุกอย่าง แก้ก่อน:

1. พบ secret อื่นใน git history ที่ไม่รู้มาก่อน → rotate ทันที
2. Cross-tenant data leak ใน integration test → จัดลำดับ priority สูงสุด
3. Database backup restore fail → ห้าม launch จนกว่าจะแก้
4. Production error rate > 5% ใน 30 นาที → rollback immediate

---

## 📊 Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Solo dev burnout | High | High | จำกัด 8 ชม./วัน, พักทุก 90 นาที, ห้าม commit หลัง 22:00 |
| Manual payment ops bottleneck (เกิน 2 ชม.) | Medium | High | SLA ผ่อนปรน "next business day" สำหรับนอกเวลา + auto-grace 24 ชม. |
| Pentest firm หาไม่ได้ใน 6 สัปดาห์ | High | Medium | Self-pentest ก่อน, จองคิว firm พร้อมกัน post-launch ภายใน 3 เดือนแรก |
| Migration เก่าถูกแก้แล้ว breaking change | Medium | High | Test migration บน staging fresh DB ก่อนทุก deploy |
| Beta tenant พบ data leak | Low (หลัง W2) | Critical | INCIDENT_RESPONSE runbook พร้อม + contract มี data breach clause |

---

## 🧰 Tools / Services ที่ต้อง sign up

- [ ] Sentry (free tier, 5k events/month)
- [ ] BetterStack / Uptime Robot (free)
- [ ] AWS S3 หรือ Backblaze B2 สำหรับ backup (~$1/month at beta scale)
- [ ] Domain + SSL (Let's Encrypt)
- [ ] Discord webhook สำหรับ ops alerts (free, มีอยู่แล้ว)
- [ ] Status page (BetterStack free)
- [ ] gitleaks pre-commit (free CLI)
- [ ] Pentest firm RFP — ส่งให้ 3-5 เจ้าใน TH (e.g., SecPro, OWASP TH listed firms)

---

## 💰 Budget Estimate (Beta Phase)

| Item | Cost/month |
|------|-----------|
| VPS (4 CPU, 8GB RAM) | ~฿1,500 |
| MySQL managed (or self-hosted) | ~฿800 |
| Redis | ~฿300 (or share VPS) |
| S3 backup (50GB) | ~฿100 |
| Sentry / Uptime Robot | ฿0 (free tiers) |
| Domain + SSL | ฿0 (LE) / ~฿400/yr |
| **Total** | **~฿2,700/month** |

Pentest firm (one-time): ~฿80,000–200,000 ขึ้นกับ scope

---

## 📝 Daily Routine (Solo Mode)

```
09:00-09:15  Check Sentry / uptime overnight (W4+)
09:15-12:00  Deep work — primary sprint task
12:00-13:00  Lunch (ห้าม code)
13:00-15:00  Deep work — secondary task
15:00-15:15  Break + review morning code
15:15-17:00  Tests + integration
17:00-17:30  Commit + push + update GO_LIVE_PLAN.md checkboxes
17:30-18:00  ตอบ ops issues (W5+)
```

> ห้ามทำ code review ในวันเดียวกับเขียน — รอข้ามคืนแล้วอ่านใหม่ก่อน commit ขึ้น main (solo trick)

---

## 🔄 Weekly Review (ทุกวันศุกร์ 16:00)

ถาม 4 ข้อ:

1. Sprint นี้ผ่าน DoD ทุกอันมั้ย? ที่ไม่ผ่าน — ดันไปสัปดาห์หน้าหรือ scope-cut?
2. มี risk ใหม่อะไรเข้ามา?
3. ตัว next sprint มีอะไร dependency กับสิ่งที่ค้างมั้ย?
4. Energy ตัวเองอยู่ระดับไหน? burnout signal เริ่มมั้ย?

ถ้าตอบไม่ดี 2 ข้อ → scope cut, ไม่ใช่ทำงานเพิ่ม

---

## ✅ Launch Day Checklist (Week 6 Day 7)

ลำดับเช้าวัน soft-launch:

- [ ] 08:00 รัน DB backup manual
- [ ] 08:15 Deploy latest to production (zero-downtime)
- [ ] 08:30 Smoke test endpoint หลัก (`/health`, `/health/ready`, login, dashboard)
- [ ] 08:45 Sentry / Uptime monitoring ทุกระบบ green
- [ ] 09:00 Invite beta tenant #1 (preferred friend hotel)
- [ ] 11:00 First check-in call with beta #1 — ใช้งานได้ปกติ?
- [ ] 14:00 Invite beta tenant #2
- [ ] 17:00 EOD summary + post in `INCIDENT_RESPONSE.md` "Launch Day Log"

---

> **Last updated:** 2026-05-17
> **Owner:** IT @ organicscosme.com
> **Review cadence:** ทุกศุกร์ 16:00
