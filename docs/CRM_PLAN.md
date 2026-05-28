# CRM Sub-System Plug-in Plan — StaySync

> วันที่: 2026-05-28 · ระบบ: owner-hotel-services-api + owner-hotel-services
> Scope: เพิ่ม CRM Terminal เป็น Sub-System ใหม่ พร้อม Integration กับโมดูลเดิม

## 1. สรุปการตัดสินใจสถาปัตยกรรม

CRM ถูก deploy เป็น **Sub-System Terminal แยก** (เหมือน Restaurant POS, Procurement, Warehouse) — มี Login แยก, session แยก, role-based access แต่ใช้ Prisma schema กลางและ Event Bus ร่วมกัน ทำให้ข้อมูล guest, booking, review ไหลเข้า CRM โดยอัตโนมัติ และส่ง campaign/ticket กลับออกผ่าน Notifications module เดิม

## 2. โครงสร้างโมดูล (4 Pillars)

| Pillar | NestJS Module | หน้าที่หลัก |
|---|---|---|
| Guest 360° | `modules/crm/guest-360/` | Unified profile, preferences, stay history, RFM segmentation, PDPA consent |
| Marketing Automation | `modules/crm/automation/` | Campaign (Email/LINE/SMS/Push), Journey flow (pre-stay, post-stay, birthday), A/B test |
| Sales Pipeline | `modules/crm/sales/` | Lead → Account → Deal → Group Booking, Forecasting, Contract rates |
| Customer Service | `modules/crm/service-desk/` | Ticket workflow, SLA, Auto-classify (LINE/FB), CSAT/NPS feedback loop |

ทั้ง 4 pillar อยู่ใน parent module `modules/crm/crm.module.ts` ที่ register submodules + Guards + Subscribers

## 3. โมดูลใหม่ที่ต้องเพิ่ม (อ้างจาก codebase ปัจจุบัน)

จากการสำรวจ ปัจจุบันยังขาด:

- `modules/crm/` — ตัว CRM core ทั้ง 4 pillar
- `modules/loyalty/` — Tier, Points, Reward (มี OpMarketingCampaign แล้ว แต่ยังไม่มี Loyalty)
- `modules/promotions/` — Coupon, Discount rules, Campaign codes
- `modules/notifications/` — งาน Email/LINE/Push (มีกระจายอยู่ใน messaging + Notification model แต่ควรรวมเป็น service กลาง)

โมดูลเดิมที่จะถูกใช้งาน (ไม่ต้องสร้างใหม่):

- `guests` (เพิ่มคอลัมน์ tag/segment ผ่าน migration)
- `bookings` (เป็น event source — booking.created, checked_in, checked_out)
- `reviews` (event source — review.submitted)
- `messaging` (LINE/Facebook + AutoReplyTemplate — เชื่อม CRM Service Desk)
- `analytics` (AnalyticsEvent model)
- `reports`

## 4. Prisma Schema เพิ่มเติม (ตัวอย่าง)

```prisma
model CrmContact {
  id            String   @id @default(uuid())
  tenantId      String
  guestId       String?  // link ไป Guest ถ้ามาจาก booking
  companyName   String?
  rfmScore      Int?
  segment       String?  @db.VarChar(50)
  lifetimeValue Decimal? @db.Decimal(12, 2)
  tags          String?  @db.Text   // JSON array
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  guest         Guest?   @relation(fields: [guestId], references: [id])
  deals         CrmDeal[]
  tickets       CrmTicket[]
  @@map("crm_contacts")
  @@index([tenantId, segment])
}

model CrmLead {
  id          String   @id @default(uuid())
  tenantId    String
  source      String   // ota, website, email, walk-in, referral
  status      String   @default("new")  // new, qualified, lost
  ownerUserId String?
  contactId   String?
  estValue    Decimal? @db.Decimal(12, 2)
  createdAt   DateTime @default(now())
  @@map("crm_leads")
}

model CrmDeal {
  id          String   @id @default(uuid())
  tenantId    String
  contactId   String
  stage       String   // discovery, quoted, negotiation, won, lost
  amount      Decimal  @db.Decimal(12, 2)
  closeDate   DateTime?
  bookingIds  String?  @db.Text // JSON array of linked bookings
  @@map("crm_deals")
}

model CrmTicket {
  id           String   @id @default(uuid())
  tenantId     String
  contactId    String?
  bookingId    String?
  channel      String   // line, email, phone, walk-in
  priority     String   // low, normal, high, urgent
  status       String   @default("open") // open, in_progress, resolved, closed
  category     String?
  slaDueAt     DateTime?
  resolvedAt   DateTime?
  csatScore    Int?
  @@map("crm_tickets")
}

model LoyaltyAccount {
  id          String   @id @default(uuid())
  tenantId    String
  guestId     String   @unique
  tier        String   @default("bronze") // bronze, silver, gold, platinum
  points      Int      @default(0)
  lifetimePoints Int   @default(0)
  @@map("loyalty_accounts")
}

model LoyaltyTransaction {
  id          String   @id @default(uuid())
  accountId   String
  type        String   // earn, redeem, expire, adjust
  points      Int
  bookingId   String?
  reason      String?  @db.Text
  createdAt   DateTime @default(now())
  @@map("loyalty_transactions")
}

model Campaign {
  id          String   @id @default(uuid())
  tenantId    String
  name        String
  channel     String   // email, line, sms, push
  templateId  String?
  audienceQuery String? @db.Text  // JSON segmentation rules
  status      String   @default("draft") // draft, scheduled, running, completed
  scheduledAt DateTime?
  @@map("crm_campaigns")
}
```

## 5. API Endpoints (ตัวอย่าง)

```
# Guest 360
GET    /api/v1/crm/contacts?segment=vip&minLtv=10000
GET    /api/v1/crm/contacts/:id          # รวม stay history + spend + tickets
POST   /api/v1/crm/contacts/:id/tags
POST   /api/v1/crm/contacts/:id/merge

# Marketing Automation
POST   /api/v1/crm/campaigns
POST   /api/v1/crm/campaigns/:id/schedule
GET    /api/v1/crm/campaigns/:id/stats
POST   /api/v1/crm/journeys              # define automation flow
POST   /api/v1/crm/journeys/:id/enroll/:contactId

# Sales Pipeline
POST   /api/v1/crm/leads
PATCH  /api/v1/crm/leads/:id/qualify
POST   /api/v1/crm/deals
PATCH  /api/v1/crm/deals/:id/move-stage
POST   /api/v1/crm/deals/:id/quote        # generate PDF + email

# Service Desk
POST   /api/v1/crm/tickets
PATCH  /api/v1/crm/tickets/:id/assign
PATCH  /api/v1/crm/tickets/:id/resolve
GET    /api/v1/crm/tickets?status=open&priority=high

# Loyalty (new module)
GET    /api/v1/loyalty/accounts/:guestId
POST   /api/v1/loyalty/accounts/:guestId/earn
POST   /api/v1/loyalty/accounts/:guestId/redeem
```

## 6. Event Bus Contract

CRM ทำงานแบบ event-driven ใช้ `@nestjs/event-emitter` + Bull queue:

| Event | Emitted by | Subscribed by |
|---|---|---|
| `booking.created` | bookings | crm/guest-360, crm/automation |
| `booking.checked_in` | bookings | crm/automation (in-stay journey) |
| `booking.checked_out` | bookings | crm/automation (post-stay), loyalty (award points) |
| `folio.paid` | accounting | loyalty (calc points) |
| `review.submitted` | reviews | crm/guest-360 (update sentiment), crm/service-desk (low score → ticket) |
| `message.received` | messaging | crm/service-desk (auto-classify) |
| `campaign.scheduled` | crm/automation | bull-queue (delayed dispatch) |
| `ticket.opened` | crm/service-desk | notifications, maintenance (ถ้า category=maintenance) |
| `loyalty.tier_upgraded` | loyalty | crm/automation (trigger upgrade campaign) |

## 7. Frontend (Next.js) — CRM Terminal

โครงสร้างใหม่ที่ frontend `owner-hotel-services`:

```
app/crm-terminal/
├── layout.tsx               # Terminal shell + sidebar
├── login/page.tsx           # Separate login (เหมือน /hotel-terminal)
├── dashboard/page.tsx       # KPI overview
├── contacts/                # Guest 360
├── campaigns/               # Marketing Automation builder
├── pipeline/                # Sales board (Kanban)
└── tickets/                 # Service Desk inbox

components/CrmTerminal/
├── ContactProfile.tsx
├── CampaignBuilder.tsx
├── PipelineBoard.tsx
├── TicketInbox.tsx
└── SegmentationFilter.tsx

lib/stores/
├── crmContactStore.ts
├── crmCampaignStore.ts
└── crmTicketStore.ts
```

เพิ่ม card ใหม่ใน Sub-System dashboard เดิม (ตามภาพที่ user ส่งมา) — ใช้ icon สีเขียวเพื่อให้แตกต่างจาก existing terminals

## 8. Roadmap (Phase Plan)

| Phase | Scope | ระยะเวลา |
|---|---|---|
| Phase 1 (MVP) | Guest 360 + ticket workflow + Loyalty earn/redeem พื้นฐาน | 4-6 สัปดาห์ |
| Phase 2 | Marketing Automation (campaign builder, journey flow), Promotions module | 4-6 สัปดาห์ |
| Phase 3 | Sales Pipeline (Leads, Deals, Group booking quote) | 4 สัปดาห์ |
| Phase 4 | AI features (auto-classify ticket, sentiment, churn prediction) | 4-6 สัปดาห์ |

## 9. Security & Compliance

- JWT + role guard ใหม่ `@Roles('crm_manager', 'crm_agent', 'sales_rep')`
- PDPA consent ใช้ของเดิมใน Guest model (`consentGiven`, `consentVersion`)
- Audit log ทุก action ที่แก้ contact data ผ่าน `AuditLogService`
- Rate limit `@Throttle()` กับ public-facing endpoints (เช่น webhook จาก LINE)
- ห้าม campaign ส่งหา contact ที่ไม่ได้ consent — บังคับ filter ใน Audience Query
- Multi-tenant: ทุก query ต้องมี `tenantId` (เหมือน module เดิม)

## 10. Integration Points (สรุปจากภาพ Architecture)

1. **Sub-System Layer**: เพิ่มการ์ดที่ 7 ใน dashboard เดิม + SSO เปิด Terminal
2. **Bookings/Guests**: subscribe event เพื่อ enrich CrmContact
3. **Reviews**: ใช้เป็น input ของ sentiment + auto-ticket
4. **Messaging (LINE/FB)**: เชื่อม Service Desk (สอง direction)
5. **Loyalty/Promotions**: โมดูลใหม่ ทำงานร่วมกับ CRM Automation
6. **Notifications**: ตัว outbound กลาง — CRM ไม่ส่งเอง แต่ enqueue job ให้ notifications service ส่ง
7. **Analytics/Reports**: CRM emit AnalyticsEvent เพื่อให้ dashboard เดิมเห็นภาพรวม
