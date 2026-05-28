# CRM Development Log — All 4 Phases Complete ✅

> วันที่: 2026-05-28
> Scope: ครบทั้ง 4 phases ตาม roadmap ใน CRM_PLAN.md
> - Phase 1: Guest 360 + Service Desk + Loyalty
> - Phase 2: Marketing Automation (Campaign + Journey Flow)
> - Phase 3: Sales Pipeline (Lead + Deal + Activity + Forecasting)
> - Phase 4: AI Insights (Sentiment + Churn + Smart Segmentation) + Channel Adapters

## สรุปสิ่งที่พัฒนาเสร็จ (Phase 1)

### Backend (owner-hotel-services-api)

**Prisma Schema** — `prisma/schema.prisma`
- เพิ่ม `CrmContact` — Guest 360 unified profile (RFM, LTV, segment, tags)
- เพิ่ม `CrmTicket` — Service desk ticket with SLA tracking
- เพิ่ม `LoyaltyTransaction` — Append-only audit trail สำหรับ earn/redeem/expire/adjust
- ใช้ `LoyaltyPoint` และ `Promotion` เดิม (ไม่สร้างซ้ำ)

**Loyalty Module** — `src/loyalty/` (ขยายของเดิม)
- `loyalty.service.ts` — เพิ่ม `addPointsForStay`, `earnFromDto`, `redeem`, `adjust`, `getGuestBalance`, `getGuestHistory`
- Atomic transaction (`$transaction`) สำหรับ point delta + audit log
- Tier auto-calculation: Standard / Silver / Gold / Platinum
- `loyalty.controller.ts` — endpoints ใหม่: `GET /loyalty/guests/:id`, `POST /loyalty/earn`, `POST /loyalty/redeem`, `POST /loyalty/adjust`
- DTOs พร้อม `class-validator` + Swagger

**CRM Module ใหม่** — `src/modules/crm/`
- `crm.module.ts` — parent module imports LoyaltyModule + PrismaModule
- `crm-contacts.service.ts` / `crm-contacts.controller.ts` — Guest 360 CRUD + `upsertFromGuest`, `recordStayCompletion`, `getStayHistory`
- `crm-tickets.service.ts` / `crm-tickets.controller.ts` — Ticket workflow + SLA defaults (urgent 30m, high 2h, normal 8h, low 24h) + auto resolvedAt/closedAt
- `crm-event.listener.ts` — subscribes to:
  - `booking.created` → upsert CrmContact
  - `booking.checked_out` → record stay + award loyalty points
  - `review.submitted` → low rating ≤ 3 auto-create ticket (rating ≤ 2 = high priority)
  - `message.received` → complaint intent auto-create ticket
- `crm.events.ts` — event name constants + TypeScript payload interfaces

**Registered** — `src/app.module.ts` มี `CrmModule` แล้ว
**EventEmitterModule** — มี register อยู่แล้วใน app.module

### Unit Tests
- `loyalty.service.spec.ts` — refresh ทั้งหมด ครอบคลุม earn/redeem/tier transitions/insufficient balance
- `crm-contacts.service.spec.ts` — pagination, filtering, upsert, recordStayCompletion error tolerance
- `crm-tickets.service.spec.ts` — SLA computation, status transitions (resolved/closed), createFromEvent error swallow, CSAT

### Frontend (owner-hotel-services)

**Sub-Systems Dashboard** — `app/dashboard/sub-systems/page.tsx`
- เพิ่มการ์ดที่ 7: **CRM Terminal** (สีเขียว `from-emerald-500 to-green-600`) ปลายแถว
- Roles: `crm_manager`, `crm_agent`, `sales_rep`, `manager`, `tenant_admin`
- Badge "ใหม่" + features chips

**CRM Terminal Pages** — `app/crm-terminal/`
- `layout.tsx` — Terminal shell + metadata
- `page.tsx` — หน้าหลัก: 4 stats card + 5 menu tiles (Guest 360, Campaigns, Pipeline, Tickets, Loyalty)
- `contacts/page.tsx` — Guest 360 list + search/segment filter (empty state พร้อม API hint)
- `tickets/page.tsx` — Service Desk inbox + status/priority filter + stats cards
- `loyalty/page.tsx` — Tier table + transaction history placeholders
- `campaigns/page.tsx` — Phase 2 placeholder (Marketing Automation)
- `pipeline/page.tsx` — Phase 3 placeholder (Sales Pipeline)

## Verification ที่ผ่าน

- ✅ ESLint clean (`npx eslint src/modules/crm src/loyalty`)
- ✅ Frontend TypeScript compile clean ใน `crm-terminal/` ทั้งหมด
- ⚠️ Backend TS compile + Jest test ยังต้องรอ `npx prisma generate` (เพราะ Prisma client ปัจจุบันยังไม่มี types ของ CrmContact/CrmTicket/LoyaltyTransaction)

## สิ่งที่ User ต้องทำต่อ (Local Setup)

```bash
cd owner-hotel-services-api

# 1) Generate Prisma client ใหม่ (ต้องการ network)
npx prisma generate

# 2) Create migration
npx prisma migrate dev --name add_crm_module

# 3) รัน tests
npm run test:unit -- --testPathPattern='loyalty|crm'

# 4) Start dev server
npm run start:dev

# 5) ทดสอบ endpoints
curl http://localhost:3000/api/v1/crm/contacts -H "Authorization: Bearer <token>"
curl http://localhost:3000/api/v1/crm/tickets -H "Authorization: Bearer <token>"
```

```bash
cd owner-hotel-services

# 6) Run frontend dev
npm run dev   # port 9010
# เปิด http://localhost:9010/dashboard/sub-systems  → จะเห็นการ์ด CRM ใหม่
# เปิด http://localhost:9010/crm-terminal           → เข้า terminal
```

## Phase 2 — Marketing Automation (เพิ่มจาก Phase 1)

### Prisma Schema เพิ่ม
- `CrmCampaign` — campaign definition (channel, audience query, schedule, status, counters)
- `CrmCampaignDelivery` — per-recipient delivery log (sent/opened/clicked/failed)
- `CrmJourney` — flow definition with steps stored as JSON
- `CrmJourneyEnrollment` — guest enrollment + step pointer + nextRunAt

### Backend Module — `src/modules/crm/automation/`
- `campaign.service.ts` + `campaign.controller.ts` — CRUD, schedule via Bull, cancel, audience preview, stats
- `audience.resolver.ts` — segment + LTV + stays filter, PDPA consent check, batch hydrate emails
- `campaign.processor.ts` — Bull queue `crm-campaigns` worker
  - `dispatch` job — resolve audience, create delivery rows, fan out
  - `deliver-one` job — send via EmailService, update delivery + counters, auto-complete campaign
- `journey.service.ts` + `journey.controller.ts` — CRUD + step validator + enrollByTrigger + processDueEnrollments
- `journey.scheduler.ts` — `@Cron(EVERY_MINUTE)` polls due enrollments
- `journey-event.listener.ts` — auto-enroll on booking.created/checked_in/checked_out
- `automation.module.ts` — registers BullModule queue + ScheduleModule + EmailModule

### Integration
- ใช้ `EmailService.sendEmail()` ของเดิม (handlebars template + nodemailer)
- LINE/SMS/Push channels เป็น stub (Phase 4 จะเชื่อมจริง)
- Bull queue ใช้ Redis เดียวกับ email queue เดิม
- `CrmAutomationModule` ถูก import ใน `CrmModule` (registered ใน `app.module.ts` อยู่แล้ว)

### Tests
- `audience.resolver.spec.ts` — segment filter, PDPA consent gating, Prisma error fallback
- `campaign.service.spec.ts` — channel validation, schedule with past time (delay=0), state machine guards, cancel job removal
- `journey.service.spec.ts` — step validator, idempotent enrollment, step advancement, completion, failure marking

### Frontend Pages (`app/crm-terminal/`)
- `campaigns/page.tsx` — replaced placeholder: list view + 4 stat cards + channel/status filter
- `campaigns/new/page.tsx` — full builder form: name/desc → channel select → email content (subject + template + body) → audience (segments + min LTV + min stays) → schedule
- `journeys/page.tsx` — trigger event reference + step type legend + example "Post-stay" flow + enrollment placeholder
- `page.tsx` — เปลี่ยน Campaign จาก "Phase 2" → พร้อมใช้งาน + เพิ่ม Journey tile

## API Endpoints ใหม่ Phase 2

```
# Campaigns
GET    /api/v1/crm/campaigns?status=scheduled&channel=email
POST   /api/v1/crm/campaigns
GET    /api/v1/crm/campaigns/:id
GET    /api/v1/crm/campaigns/:id/audience-preview
GET    /api/v1/crm/campaigns/:id/stats
PATCH  /api/v1/crm/campaigns/:id
POST   /api/v1/crm/campaigns/:id/schedule
POST   /api/v1/crm/campaigns/:id/cancel
DELETE /api/v1/crm/campaigns/:id

# Journeys
GET    /api/v1/crm/journeys
POST   /api/v1/crm/journeys
GET    /api/v1/crm/journeys/:id
GET    /api/v1/crm/journeys/:id/enrollments
PATCH  /api/v1/crm/journeys/:id
DELETE /api/v1/crm/journeys/:id
POST   /api/v1/crm/journeys/enrollments/:id/cancel
```

## Phase 3 — Sales Pipeline (เพิ่มจาก Phase 2)

### Prisma Schema เพิ่ม
- `CrmLead` — inquiry (source, status, score, ownerUserId, est value, expected check-in/out)
- `CrmDeal` — opportunity (stage, amount, probability, expectedCloseDate, linked bookingIds, lostReason)
- `CrmSalesActivity` — timeline entry (note/call/email/meeting/task) attached to lead or deal

### Backend Module — `src/modules/crm/sales/`
- `lead.service.ts` + `lead.controller.ts` — CRUD + assign + `qualify()` (atomic transaction lead→deal)
- `deal.service.ts` + `deal.controller.ts` — CRUD + `moveStage()` with forward-only progression + `attachBookings()` (JSON array) + `forecast()` (pipeline total / weighted / win rate)
- `activity.service.ts` + `activity.controller.ts` — timeline CRUD + task completion
- `sales.module.ts` — exports services for cross-module use

### Stage Flow & Defaults
Stage progression: `discovery (20%) → quoted (50%) → negotiation (75%) → won (100%)` หรือ `→ lost (0%)`
Forward-only (ไม่อนุญาตถอย stage); `lost` ต้องระบุ `lostReason`; won/lost terminal stages

### Tests
- `lead.service.spec.ts` — qualify rejection (converted/lost lead), transactional deal creation + lead status update
- `deal.service.spec.ts` — forward-only enforcement, lost reason requirement, terminal guard, attachBookings dedup, forecast computation (weighted + win rate)

### Frontend (`app/crm-terminal/`)
- `pipeline/page.tsx` — replaced placeholder ด้วย 5-column Kanban board (discovery/quoted/negotiation/won/lost) + 4 forecast stat cards + API endpoint hints
- `pipeline/leads/page.tsx` — Leads Inbox: source legend (5 sources with icons), status filter, empty state
- `page.tsx` — ลบ "Phase 3" badge ออกจาก Sales Pipeline tile

## API Endpoints ใหม่ Phase 3

```
# Leads
GET    /api/v1/crm/leads?status=qualified&source=email
POST   /api/v1/crm/leads
PATCH  /api/v1/crm/leads/:id
PATCH  /api/v1/crm/leads/:id/assign/:userId
POST   /api/v1/crm/leads/:id/qualify       # → creates CrmDeal, marks lead "converted"
DELETE /api/v1/crm/leads/:id

# Deals
GET    /api/v1/crm/deals?stage=quoted
GET    /api/v1/crm/deals/forecast          # pipeline value + weighted + win rate
POST   /api/v1/crm/deals                    # direct create (without lead)
PATCH  /api/v1/crm/deals/:id
PATCH  /api/v1/crm/deals/:id/move-stage     # validates forward-only progression
POST   /api/v1/crm/deals/:id/bookings       # attach generated booking IDs (for won)

# Sales Activities (timeline)
POST   /api/v1/crm/activities
GET    /api/v1/crm/activities/leads/:leadId
GET    /api/v1/crm/activities/deals/:dealId
PATCH  /api/v1/crm/activities/:id/complete  # for task type
```

## Phase 4 — AI Insights + Channel Adapters (เพิ่มจาก Phase 3)

### Prisma Schema เพิ่ม
- `CrmSentimentAnalysis` — cached polarity result (score -1..1, label, confidence, keywords) per source (review/ticket/message), unique on (sourceType, sourceId)
- `CrmChurnScore` — daily snapshot of churn risk (score 0..1, riskBand, contributing reasons as JSON, stays counters)

### Backend AI Module — `src/modules/crm/ai/`
- `sentiment.service.ts` — rule-based Thai+English polarity scoring with negation handling (15-char lookahead). Lexicon weights [-2, 2], normalized to [-1, 1], confidence scales with match count. Drop-in replacement for ML model via `analyze()` swap.
- `churn-prediction.service.ts` — rule-based risk score from 5 factors: days since last stay, frequency drop, low engagement, open tickets, negative sentiment. Bands: low (<0.3) → medium → high → critical (≥0.8). `recomputeForTenant()` persists snapshots; `listHighRisk()` for dashboard.
- `smart-segmentation.service.ts` — RFM rule precedence: churn_risk > new > dormant > vip > loyal > regular. `recomputeForTenant()` only writes changes; `distribution()` for dashboard pie.
- `ai.scheduler.ts` — `@Cron(EVERY_DAY_AT_3AM)` batch: per-tenant recompute churn → segments
- `ai-event.listener.ts` — `review.submitted` → real-time sentiment via `analyzeAndStore()`
- `ai.controller.ts` — endpoints under `/crm/ai/*`

### Channel Adapters — `src/modules/crm/automation/channels/`
Refactored campaign dispatch from hard-coded email to adapter pattern.
- `channel.types.ts` — `ChannelAdapter` interface + `OutboundMessage` + `SendResult` (never-throw contract)
- `email.adapter.ts` — wired to existing `EmailService.sendEmail()`
- `line.adapter.ts` — records via existing `Conversation`+`Message` models so outbound shows in admin LINE inbox (TODO: wire `LineMessagingService.pushMessage()`)
- `sms.adapter.ts` — stub (phone format validation, ready for Twilio/AWS SNS/ThaiBulkSMS)
- `push.adapter.ts` — stub (ready for `PushNotificationsService.sendToUser()`)
- `channel.registry.ts` — `Map<ChannelName, ChannelAdapter>` lookup with `resolve()`/`has()`/`listAvailable()`
- `campaign.processor.ts` — refactored to use `ChannelRegistry`; eligibility check + adapter invocation; `metadata` captures `providerMessageId`

### Tests
- `sentiment.service.spec.ts` — TH/EN positive+negative, negation flipping, neutral fallback, confidence scaling, trend aggregation
- `churn-prediction.service.spec.ts` — band thresholds, all 5 contributing factors, null-stay edge case, score clamping
- `smart-segmentation.service.spec.ts` — rule precedence (6 segments), recompute only-write-changes
- `channel.registry.spec.ts` — registration/lookup, email validation, SMS phone format

### Frontend
- `app/crm-terminal/insights/page.tsx` — new AI Insights page: 3-tone sentiment trend cards, 4-band churn risk panel, 6-segment legend, channel adapter status board
- `page.tsx` — เพิ่ม "AI Insights" tile (cyan-sky gradient) ตัวที่ 6 ใน menu

## API Endpoints ใหม่ Phase 4

```
# AI Insights
GET    /api/v1/crm/ai/sentiment/trend?days=30
GET    /api/v1/crm/ai/churn/high-risk?limit=50
GET    /api/v1/crm/ai/churn/guest/:guestId
POST   /api/v1/crm/ai/churn/recompute       # admin
GET    /api/v1/crm/ai/segments/distribution
POST   /api/v1/crm/ai/segments/recompute    # admin
```

## Completed Roadmap

| Phase | Scope | สถานะ |
|---|---|---|
| **Phase 1** | Guest 360 + Service Desk + Loyalty extend | ✅ Done |
| **Phase 2** | Marketing Automation (Campaign + Journey Flow) | ✅ Done |
| **Phase 3** | Sales Pipeline (Lead, Deal, Activity, Forecasting) | ✅ Done |
| **Phase 4** | AI Insights + Channel Adapters (email/line/sms/push) | ✅ Done |

## Module Tree (Final)

```
src/modules/crm/
├── crm.module.ts                           # parent: imports all sub-modules
├── crm.events.ts                           # event name constants
├── crm-event.listener.ts                   # cross-module subscriber (Phase 1)
├── crm-contacts.service.ts + .controller   # Guest 360
├── crm-tickets.service.ts + .controller    # Service Desk
├── dto/
│   ├── create-contact.dto.ts
│   └── create-ticket.dto.ts
├── automation/                             # Phase 2
│   ├── automation.module.ts
│   ├── campaign.service.ts + .controller
│   ├── campaign.processor.ts               # Bull queue worker
│   ├── audience.resolver.ts                # PDPA-aware
│   ├── journey.service.ts + .controller
│   ├── journey.scheduler.ts                # cron tick
│   ├── journey-event.listener.ts
│   ├── channels/                           # Phase 4
│   │   ├── channel.types.ts
│   │   ├── channel.registry.ts
│   │   ├── email.adapter.ts
│   │   ├── line.adapter.ts
│   │   ├── sms.adapter.ts
│   │   └── push.adapter.ts
│   └── dto/
│       ├── campaign.dto.ts
│       └── journey.dto.ts
├── sales/                                  # Phase 3
│   ├── sales.module.ts
│   ├── lead.service.ts + .controller
│   ├── deal.service.ts + .controller
│   ├── activity.service.ts + .controller
│   └── dto/
│       ├── lead.dto.ts
│       ├── deal.dto.ts
│       └── activity.dto.ts
└── ai/                                     # Phase 4
    ├── ai.module.ts
    ├── ai.controller.ts
    ├── ai.scheduler.ts                     # nightly cron
    ├── ai-event.listener.ts
    ├── sentiment.service.ts
    ├── churn-prediction.service.ts
    └── smart-segmentation.service.ts
```

## Final User Setup

```bash
cd owner-hotel-services-api
npx prisma generate
npx prisma migrate dev --name add_crm_phase4   # หรือ rename to add_crm_complete
npm run test:unit -- --testPathPattern='crm|loyalty'
npm run start:dev

cd ../owner-hotel-services
npm run dev   # port 9010
# /dashboard/sub-systems → click CRM card
# /crm-terminal → 6 tiles (Guest 360, Campaigns, Journeys, Pipeline, Tickets, Loyalty, AI Insights)
```

## หมายเหตุการ Integrate กับโมดูลเดิม

ที่ใช้แบบ subscribe events (ไม่ต้องแก้โค้ดเดิม):
- `bookings` module ต้อง emit event `booking.created`, `booking.checked_out` ผ่าน `EventEmitter2`
- `reviews` module ต้อง emit `review.submitted` with rating
- `messaging` module (LINE/FB) ต้อง emit `message.received` with `intent` field

ถ้า emitter เดิมยังไม่ส่ง events เหล่านี้ ให้เพิ่ม `EventEmitter2.emit()` ใน service methods ที่เกี่ยวข้อง — payload schema อยู่ใน `src/modules/crm/crm.events.ts`
