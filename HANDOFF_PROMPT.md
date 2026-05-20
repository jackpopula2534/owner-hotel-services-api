# Hand-off Prompt — StaySync VIP test user shows "no subscription" in UI

Copy this entire file as the prompt for the next AI session.

---

## Context

Project is a hotel SaaS called **StaySync**, two repos on the same machine:

- Backend (NestJS 10 + Prisma + MySQL): `/Users/todsapornsaelow/Documents/GitHub/owner-hotel-services-api`
- Frontend (Next.js 14 + Zustand): `/Users/todsapornsaelow/Documents/GitHub/owner-hotel-services`
- Backend runs on `http://localhost:9011`, Frontend on `http://localhost:9010`
- MySQL on port `9012`, DB name `hotel_services_db`

Test user being debugged:

- Email: `premium.test@email.com`
- Password: `password123`
- Should be a **VIP / Enterprise (Plan L)** account with every add-on enabled
- Subscription code in seeder: `SUB-002`, tenant slug `mountain` (Mountain View Resort)
- Tenant ID in DB: `1bfd29c9-2b17-4f72-9a79-4d3f32230309`
- Subscription ID in DB: `17d1a003-7e83-4bce-aca0-737435b56e30`
- User ID: `9861d03b-ec92-4496-8b6a-d9813f2f6a02`

---

## The Bug

After login at `localhost:9010/login` with `premium.test@email.com / password123`,
the dashboard either shows:

1. A **purple "Trial — เหลือ 9 วัน"** banner at the top (with a Trial Benefits
   popup showing "21/30 วัน" and "หมดอายุ 29 พ.ค. 2569"), and
2. The **"Sub Systems"** sidebar link is hidden, and
3. Eventually the dashboard renders the lock-screen card
   **"บริษัทยังไม่มีแพ็กเกจการใช้งาน"** ("This company has no active package")
   even though the DB clearly has an `active` Enterprise subscription.

Expected: this user should look fully paid — no trial banner, "Sub Systems" link
visible in the sidebar, full dashboard, every add-on (HR / Inventory / Cost /
Restaurant / Channel / Loyalty) usable.

---

## What's in the DB right now (verified via Prisma)

```
user.premium.test@email.com:
  status        = active
  role          = tenant_admin
  tenantId      = 1bfd29c9-2b17-4f72-9a79-4d3f32230309
  allowedSystems= ["main","pos"]
  password hash = bcrypt of "password123"  ✅ login works

tenants (1bfd29c9-…):
  status        = active
  trial_ends_at = 2025-05-20  (1 year in the PAST — set by fix-vip-subscription.js)

subscriptions (17d1a003-…):
  subscription_code = SUB-002
  status            = active
  plan_id           → Plan L (Enterprise, code = "L")
  start_date        = ~1 month ago
  end_date          = 2027-05-20   (~1 year from now — set by fix-vip-subscription.js)
  auto_renew        = 1

plan_addons for plan_id of Plan L:
  RESTAURANT_MODULE, POS_MODULE, HR_MODULE, HOUSEKEEPING_MODULE,
  MAINTENANCE_MODULE, CHANNEL_MANAGER, OTA_INTEGRATION, EXTRA_ANALYTICS,
  LOYALTY_MODULE, INVENTORY_MODULE, COST_ACCOUNTING_MODULE, AUTOMATION_MODULE
  (all present, all is_active = 1)
```

So the database is correct. The bug is somewhere between the DB and the UI.

---

## What the UI shows (latest screenshot)

The dashboard renders a lock-screen card with text:
> "บริษัทยังไม่มีแพ็กเกจการใช้งาน — ฟังก์ชันการจัดการระบบถูกระงับ คุณต้องเลือกซื้อ
> แพ็กเกจเพื่อให้บริษัทนี้สามารถกลับมาใช้งานระบบได้อย่างเต็มรูปแบบ"

This card is shown when the frontend believes the tenant has **no active
subscription**. It exists somewhere in `app/dashboard/page.tsx` or
`components/dashboard/*` — the relevant text is the unique string above.

So the actual symptom is: **frontend's `useSubscriptionStore` ends up with
`subscription = null` / `hasSubscription = false`** even though the API has
real data to return.

Possible root causes (these still need to be confirmed):

1. `/api/v1/subscriptions/tenant/:tenantId` returns 404 / null for this tenant
   (maybe service is filtering by `status: ACTIVE` differently, or by
   `endDate >= today` and the date comparison is off, or the controller is
   guarded and rejects this user).
2. The frontend is sending the wrong tenantId in the URL (e.g. it's pulling
   from a stale persisted store and hitting `tenant/undefined`).
3. The backend response shape doesn't match what `subscriptionStore.fetchSubscription`
   expects (`subscription.id && subscription.status` check on line 99 of
   `lib/stores/subscriptionStore.ts`).
4. CORS / auth issue — the request is rejected silently.

---

## What's already been changed (do NOT redo these)

### Backend repo (`owner-hotel-services-api`)

1. **`.env`**: changed `SEED_DEFAULT_PASSWORD=SeedDev@2026!` → `SEED_DEFAULT_PASSWORD=password123`
   so seeder hashes `password123`.

2. **`src/seeder/seeder.service.ts`**:
   - Added `vipStart` / `vipEnd` date pair (1 year window) right after the
     existing `activeStart` / `activeEnd` block (around line 855).
   - SUB-002 hotel entry now uses `vipStart` / `vipEnd` instead of
     `activeStart` / `activeEnd` (the comment block in the SUB-002 record
     explains why).

3. One-off scripts in repo root (safe to delete after the bug is fixed):
   - `reset-test-password.js` — hashes `password123` into all 4 demo user accounts.
   - `diagnose-login.js` — dumps user record + tests bcrypt candidates.
   - `diagnose-addons.js` — dumps plan_addons / plan_features / subscription_features for the tenant.
   - `diagnose-subscription.js` — dumps subscription + plan for the tenant.
   - `fix-vip-subscription.js` — updates SUB-002 in DB to `end_date = now+1y`, `auto_renew=1`, `tenants.trial_ends_at = now-1y`.
   - `verify-vip-state.js` — prints every field that could trigger the trial gate.

### Frontend repo (`owner-hotel-services`)

1. **`components/layout/Sidebar.tsx`** (around line 94-105):
   Added a `useEffect` that calls `fetchSubscription()` whenever
   `user?.tenantId` changes. Was previously only triggered on tenant-switch
   or by visiting Profile/Billing.

2. **`lib/stores/subscriptionStore.ts`** (inside `fetchSubscription`, around
   line 95-130):
   After a successful fetch where the returned subscription is *not* `'trial'`
   status, we now dynamically import `useOnboardingStore` and clear its
   persisted `trial` object (`isTrialActive = false`, `trialEndDate = null`),
   because `useTrialCountdown` falls back to that local-storage trial value
   and was forcing the 21/30-day badge to keep appearing.

---

## Where to look next

These are the most useful files for the next debugging step:

- `src/subscriptions/subscriptions.service.ts` (backend) — the
  `findByTenantId(tenantId)` method that the controller `/tenant/:tenantId`
  route calls. Confirm that for our tenant it actually returns the row.
  Look especially for any `where: { status: ... endDate >= today ...}` filter
  that might silently drop the row.

- `src/subscriptions/subscriptions.controller.ts` — confirm there is no
  role/tenant guard blocking the request, and that the `:tenantId` path is
  not URL-decoded into something weird.

- `lib/api/client.ts` (frontend) — find `api.subscriptions.getByTenant` and
  confirm which URL it hits and how it unwraps the response. If the backend
  wraps the response in `{ success: true, data: {...} }` and the client
  doesn't unwrap, `subscription.id` will be undefined and the store will
  flip `hasSubscription = false`.

- `lib/stores/subscriptionStore.ts` line 99:
  `const hasSub = !!(subscription && subscription.id && subscription.status);`
  — if the response is the wrapper object, this check fails.

- `app/dashboard/page.tsx` and `components/dashboard/*` — find the file that
  renders the string `บริษัทยังไม่มีแพ็กเกจการใช้งาน` to see exactly which
  selector triggers the lock screen.

- `useTrialCountdown` (`lib/hooks/useTrialCountdown.ts`) — 3-tier fallback
  chain. Tier 3 is `onboardingStore.trial.trialEndDate` from localStorage,
  which is what was producing the "21/30 วัน" badge even when subscription
  DB data was correct.

---

## Acceptance criteria for the fix

After logging in as `premium.test@email.com / password123` on a fresh browser
(or after Cmd+Shift+R + clearing `localStorage`):

1. No purple "Trial — เหลือ N วัน" banner anywhere.
2. No "บริษัทยังไม่มีแพ็กเกจการใช้งาน" lock card.
3. Sidebar shows the **"Sub Systems"** item under "แดชบอร์ด" (it's gated
   by `!isFreePlan` in `components/layout/Sidebar.tsx` around line 357).
4. Sidebar's MANAGEMENT section, when expanded, shows the **Staff / HR** item
   (gated by `hasHrModule` from `useAddonStatus` — Plan L should have
   `HR_MODULE` active).
5. Network tab: `GET /api/v1/subscriptions/tenant/1bfd29c9-2b17-4f72-9a79-4d3f32230309`
   returns 200 with a JSON body containing `id`, `status: "active"`,
   `end_date` in 2027, and a populated `plans_subscriptions_plan_idToplans`
   with `code: "L"`.

---

## How to run things

```bash
# Backend (port 9011)
cd ~/Documents/GitHub/owner-hotel-services-api
npm run start:dev

# Frontend (port 9010)
cd ~/Documents/GitHub/owner-hotel-services
npm run dev

# Re-seed (drops + reseeds; you can keep the existing DB instead)
cd ~/Documents/GitHub/owner-hotel-services-api
npm run db:refresh        # full wipe + seed
# or
npm run seed              # additive seed

# Inspect what's in DB without re-seeding
cd ~/Documents/GitHub/owner-hotel-services-api
node verify-vip-state.js
node diagnose-subscription.js
node diagnose-addons.js
```

Project-wide conventions are documented in
`owner-hotel-services-api/CLAUDE.md` and `owner-hotel-services/CLAUDE.md`
(NestJS module pattern, Prisma, Zustand, Tailwind purple StaySync theme,
etc.).

Please verify the actual HTTP response of `/api/v1/subscriptions/tenant/:id`
for this tenant first — that single piece of information will tell you
whether the bug is backend (wrong filter / 404) or frontend (response shape /
unwrap / wrong tenantId in URL).
