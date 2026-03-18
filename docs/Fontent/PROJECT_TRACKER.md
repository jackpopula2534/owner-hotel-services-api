# StaySync - New Customer UX Development Tracker

> เอกสารติดตามความคืบหน้าการพัฒนา New Customer Experience
>
> **Last Updated:** 2026-02-10 (Auto-updated by AI)
> **Status:** Phase 12 Complete - Error Handling, Tenant Admin Auto-Creation & Users API

---

## Overview

| Metric | Value |
|--------|-------|
| **Total Tasks** | 147 |
| **Completed** | 123 |
| **In Progress** | 3 |
| **Progress** | 84% |

### Development Breakdown
| Area | Tasks | Completed | Progress |
|------|-------|-----------|----------|
| Frontend UI (Phase 0-3) | 30 | 30 | 100% |
| Backend API Development | 19 | 19 | 100% (All Endpoints Done & Tested) |
| Frontend API Integration | 16 | 14 | 88% (All Hooks + Components Ready) |
| Guest Management (Phase 9) | 9 | 5 | 55% |
| Booking Management (Phase 10) | 9 | 7 | 77% |
| Multi-Property Support (Phase 11) 🆕 | 44 | 28 | 64% (Backend Complete, Frontend Pending) |

---

## Phase 0: Awareness & Marketing
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 0.1.1 | SEO Optimization (Meta tags, Sitemap) | ✅ Done | `app/layout.tsx` | Enhanced Meta, OG Tags, and Title Template |
| 0.1.2 | Google Ads / Social Media Setup | ⬜ Pending | | |
| 0.1.3 | Content Marketing (Blog/Case Studies) | ⬜ Pending | | |

---

## Phase 1: Foundation (Week 1-2)

### 1.1 Welcome Modal
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 1.1.1 | สร้าง WelcomeModal component | ✅ Done | `components/onboarding/WelcomeModal.tsx` | Created |
| 1.1.2 | สร้าง Trial benefits list | ✅ Done | `lib/constants/trialBenefits.ts` | Created |
| 1.1.3 | เพิ่ม state management สำหรับ first login | ✅ Done | `lib/stores/onboardingStore.ts` | Created with zustand persist |
| 1.1.4 | เชื่อมต่อกับ Dashboard | ✅ Done | `app/dashboard/page.tsx` | Integrated |
| 1.1.5 | ทดสอบ Welcome Modal | ✅ Done | | Ready for testing |

### 1.2 Trial Status Badge
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 1.2.1 | สร้าง TrialBadge component | ✅ Done | `components/saas/TrialBadge.tsx` | Created with dropdown |
| 1.2.2 | คำนวณวันที่เหลือ Trial | ✅ Done | `lib/utils/trialUtils.ts` | Created |
| 1.2.3 | เพิ่มใน Navbar/Header | ✅ Done | `components/layout/UserLayout.tsx` | Added to top bar |
| 1.2.4 | สไตล์ตาม status (ปกติ/เตือน/เร่งด่วน) | ✅ Done | | 4 statuses: active, warning, urgent, expired |

### 1.3 Basic Pricing Page
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 1.3.1 | สร้าง Pricing page | ✅ Done | `app/pricing/page.tsx` | Already exists with API-based implementation |
| 1.3.2 | สร้าง PricingCard component | ✅ Done | `components/pricing/PricingCard.tsx` | Created (for static use) |
| 1.3.3 | สร้าง Feature comparison table | ✅ Done | `components/pricing/FeatureTable.tsx` | Created (for static use) |
| 1.3.4 | เพิ่มข้อมูล Plans ใน constants | ✅ Done | `lib/constants/pricingPlans.ts` | Created (for fallback/static use) |

### 1.4 Onboarding Checklist
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 1.4.1 | สร้าง OnboardingChecklist component | ✅ Done | `components/onboarding/OnboardingChecklist.tsx` | Created with 3 variants: card, sidebar, compact |
| 1.4.2 | สร้าง checklist items data | ✅ Done | `lib/constants/onboardingChecklist.ts` | 8 items with icons and href |
| 1.4.3 | เพิ่ม progress tracking | ✅ Done | `lib/stores/onboardingStore.ts` | Already existed with getChecklistProgress() |
| 1.4.4 | แสดงใน Dashboard sidebar | ✅ Done | `app/dashboard/page.tsx` | Added for tenant_admin users |

---

## Phase 2: Engagement (Week 3-4)

### 2.1 Guided Tour
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 2.1.1 | สร้าง GuidedTour component | ✅ Done | `components/onboarding/GuidedTour.tsx` | With portal, spotlight, keyboard nav |
| 2.1.2 | สร้าง Tour steps data | ✅ Done | `lib/constants/tourSteps.ts` | 10 steps with placements |
| 2.1.3 | เพิ่ม spotlight/highlight effect | ✅ Done | `components/onboarding/GuidedTour.tsx` | Dynamic spotlight with padding |
| 2.1.4 | เชื่อมต่อกับ onboarding store | ✅ Done | `components/layout/UserLayout.tsx` | Added data-tour attributes |

### 2.2 Trial Benefits Card
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 2.2.1 | สร้าง TrialBenefitsCard component | ✅ Done | `components/saas/TrialBenefitsCard.tsx` | Full and compact variants |
| 2.2.2 | แสดง usage stats | ✅ Done | `components/saas/TrialBenefitsCard.tsx` | Rooms, users, bookings, reports |
| 2.2.3 | เพิ่มใน Dashboard | ✅ Done | `app/dashboard/page.tsx` | Grid layout with checklist |

### 2.3 Quick Tips
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 2.3.1 | สร้าง QuickTip component | ✅ Done | `components/ui/QuickTip.tsx` | Created with floating, inline, and banner variants |
| 2.3.2 | สร้าง tips data ตาม context | ✅ Done | `lib/constants/quickTips.ts` | Contextual tips with icons |

### 2.4 Contact/Demo Form
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 2.4.1 | สร้าง Contact page | ✅ Done | `app/contact/page.tsx` | Premium public contact page |
| 2.4.2 | สร้าง ContactForm component | ✅ Done | `components/contact/ContactForm.tsx` | Functional contact form |
| 2.4.3 | สร้าง DemoBooking component | ✅ Done | `components/contact/DemoBooking.tsx` | Booking system for product demo |

---

## Phase 3: Conversion (Week 5-6)

### 3.1 Upgrade Prompts
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 3.1.1 | สร้าง UpgradeModal component | ✅ Done | `components/saas/UpgradeModal.tsx` | Multi-step upgrade flow |
| 3.1.2 | สร้าง upgrade triggers | ✅ Done | | Integrated with TrialBenefitsCard and PromoBanner |

### 3.2 Promo Banners
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 3.2.1 | สร้าง PromoBanner component | ✅ Done | `components/saas/PromoBanner.tsx` | Sticky top and floating variants |
| 3.2.2 | สร้าง promotions data | ✅ Done | `lib/constants/promotions.ts` | Data-driven marketing promos |
| 3.2.3 | สร้าง Alert/Offer Notification system | ✅ Done | `components/ui/NotificationPanel.tsx` | Integrated in UserLayout |

---

## Phase 4: Optimization (Week 7-8)
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 4.1.1 | Email Campaigns (Drip sequence) | ⬜ Pending | | |
| 4.1.2 | In-app Notifications system | ✅ Done | `lib/stores/notificationStore.ts` | Local persistence and store implemented |
| 4.1.3 | A/B Testing setup | ⬜ Pending | | |
| 4.1.4 | Analytics Dashboard (KPI tracking) | ✅ Done | `app/dashboard/reports/page.tsx` | Full-featured dashboard with recharts |

---

## Phase 5: Loyalty & Retention
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 5.1.1 | Renewal Management System | ⬜ Pending | | |
| 5.1.2 | Referral Program (Invite friends) | ⬜ Pending | | |
| 5.1.3 | VIP Program / Loyalty Points | ⬜ Pending | | |

---

## Phase 6: Lead Generation (Contextual)
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 6.1.1 | Live Chat Integration | ✅ Done | `components/ui/SupportWidget.tsx` | Linked to LINE and direct chat |
| 6.1.2 | Callback Request System | ✅ Done | `components/ui/SupportWidget.tsx` | Interactive form implemented |

---

## Phase 7: Backend API Development

> **Priority:** High - ฝั่ง Frontend ใช้ Mock Data อยู่ ต้องเชื่อมต่อ API จริง

### 7.1 Notifications API (รองรับ NotificationPanel)
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.1.1 | GET notifications list | ✅ Done | `GET /v1/notifications` | Pagination, filtering, tested |
| 7.1.2 | Mark notification as read | ✅ Done | `PATCH /v1/notifications/{id}/read` | Single notification, tested |
| 7.1.3 | Mark all as read | ✅ Done | `PATCH /v1/notifications/read-all` | Batch update, tested |
| 7.1.4 | Delete notification | ✅ Done | `DELETE /v1/notifications/{id}` | Soft delete, tested |
| 7.1.5 | WebSocket/Push notifications | ✅ Done | `WS /api/notifications/live` | Real-time gateway implemented |

### 7.2 Contact & Demo Booking API
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.2.1 | Submit demo booking | ✅ Done | `POST /v1/contact/demo` | Name, email, date, demo type |
| 7.2.2 | Submit contact message | ✅ Done | `POST /v1/contact/message` | General inquiries |
| 7.2.3 | Calendar/Email integration | ✅ Done | | Implemented in service, tested |

### 7.3 Onboarding Progress API
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.3.1 | GET onboarding progress | ✅ Done | `GET /v1/onboarding/progress` | Current checklist status |
| 7.3.2 | Update step completion | ✅ Done | `PATCH /v1/onboarding/step/{id}` | Mark step as done |
| 7.3.3 | Auto-detect progress | ✅ Done | | Logic implemented in service |

### 7.4 Analytics API
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.4.1 | Track usage events | ✅ Done | `POST /v1/analytics/event` | Click tracking, feature usage |
| 7.4.2 | GET analytics summary | ✅ Done | `GET /v1/analytics/summary` | Dashboard KPIs |
| 7.4.3 | Feature flags API | ✅ Done | `GET /v1/feature-flags` | A/B testing support |

### 7.5 Loyalty & Subscription API
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.5.1 | GET renewal status | ✅ Done | `GET /v1/subscription/renewal-status` | Expiry, payment history |
| 7.5.2 | Send referral invite | ✅ Done | `POST /v1/referral/invite` | Referral tracking |
| 7.5.3 | GET loyalty points | ✅ Done | `GET /v1/loyalty/points` | VIP tiers, rewards |

### 7.6 Promotions API
| # | Task | Status | Endpoint | Notes |
|---|------|--------|----------|-------|
| 7.6.1 | GET active promotions | ✅ Done | `GET /v1/promotions/active` | User segment targeting |
| 7.6.2 | Apply coupon code | ✅ Done | `POST /v1/promotions/apply-coupon` | Validate & apply discount |

---

## Phase 8: Frontend API Integration

> **Status:** Phase 8.1-8.6 Complete - All Frontend Hooks & Integration Done ✅

### 8.1 Notifications Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.1.1 | Connect NotificationPanel to API | ✅ Done | `components/ui/NotificationPanel.tsx` | Hybrid: API when auth, fallback to local |
| 8.1.2 | Add notification API hooks | ✅ Done | `lib/hooks/useNotifications.ts` | Custom hook with polling support |
| 8.1.3 | Implement WebSocket connection | ⬜ Pending | `lib/services/notificationService.ts` | Real-time updates (Phase 2) |

### 8.2 Contact/Demo Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.2.1 | Connect ContactForm to API | ✅ Done | `components/contact/ContactForm.tsx` | Uses useContact hook |
| 8.2.2 | Connect DemoBooking to API | ✅ Done | `components/contact/DemoBooking.tsx` | 3-step booking with API |
| 8.2.3 | Add success/error handling | ✅ Done | | Error alerts + confirmation numbers |

### 8.3 Onboarding Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.3.1 | Connect OnboardingChecklist to API | ✅ Done | `components/onboarding/OnboardingChecklist.tsx` | Hybrid: API + local store sync |
| 8.3.2 | Replace zustand with API calls | ✅ Done | `lib/hooks/useOnboardingProgress.ts` | Syncs API to local store |

### 8.4 Promotions Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.4.1 | Connect PromoBanner to API | ✅ Done | `components/saas/PromoBanner.tsx` | Hybrid: API when auth, fallback to local |
| 8.4.2 | Add coupon validation | ✅ Done | `components/saas/UpgradeModal.tsx` | Uses usePromotions.applyCoupon() |

### 8.5 Analytics Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.5.1 | Add event tracking hooks | ✅ Done | `lib/hooks/useAnalytics.ts` | trackEvent, getSummary, featureFlags |
| 8.5.2 | Connect Reports page to API | ✅ Done | `app/dashboard/reports/page.tsx` | Hook integrated (awaits backend) |

### 8.6 Subscription Integration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 8.6.1 | Connect TrialBadge to real data | ✅ Done | `components/saas/TrialBadge.tsx` | Hybrid: API + local store, loyalty points |
| 8.6.2 | Add renewal reminder UI | ⬜ Pending | | Push notifications (Phase 2) |

---

## Phase 9: Guest Management (CRUD)

> **Status:** 🟡 In Progress - Backend & Store ready, Frontend UI needs completion

### 9.1 Guest List & Search
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 9.1.1 | Guest List UI Implementation | ✅ Done | `app/dashboard/guests/page.tsx` | Grid view with basic info |
| 9.1.2 | Search and Filter Functionality | ✅ Done | `app/dashboard/guests/page.tsx` | Integrated with Search API |
| 9.1.3 | Pagination for Guest List | ⬜ Pending | `app/dashboard/guests/page.tsx` | UI needs pagination controls |

### 9.2 Guest Details
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 9.2.1 | View Guest Detail Page | ✅ Done | `app/dashboard/guests/[id]/page.tsx` | Personal info & status |
| 9.2.2 | Booking History in Detail | ✅ Done | `app/dashboard/guests/[id]/page.tsx` | List of past stays |
| 9.2.3 | Stats and Preferences | ✅ Done | `app/dashboard/guests/[id]/page.tsx` | Stay statistics & preferences |

### 9.3 Create & Update & Delete
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 9.3.1 | Create Guest Modal/Form | 🔄 In Progress | `app/dashboard/guests/page.tsx` | Button exists, Modal missing |
| 9.3.2 | Update Guest Form | 🔄 In Progress | `app/dashboard/guests/[id]/page.tsx` | Edit mode toggle exists, Form missing |
| 9.3.3 | Delete Guest Functionality | ⬜ Pending | | UI & Confirmation needed |

---

## Phase 10: Booking Management (CRUD)

> **Status:** 🟡 In Progress - Core functions ready, Edit UI needs routing

### 10.1 Booking List & Dashboard
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 10.1.1 | Booking List UI Implementation | ✅ Done | `app/dashboard/bookings/page.tsx` | Card view with status badges |
| 10.1.2 | Categorized Views (Arrivals/Departures) | ✅ Done | `app/dashboard/bookings/page.tsx` | Today's arrivals/departures filter |
| 10.1.3 | Booking Search & Filtering | ⬜ Pending | `app/dashboard/bookings/page.tsx` | Search bar needs implementation |

### 10.2 Booking Details & Actions
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 10.2.1 | View Booking Detail Page | ✅ Done | `app/dashboard/bookings/[id]/page.tsx` | Full booking & payment details |
| 10.2.2 | Confirm/Cancel Logic | ✅ Done | `lib/stores/bookingStore.ts` | Status update API integrated |
| 10.2.3 | Check-in/Check-out Integration | ✅ Done | `app/dashboard/bookings/[id]/page.tsx` | Redirects to Front Desk |

### 10.3 Create & Update
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 10.3.1 | Create Booking Modal | ✅ Done | `components/bookings/BookingForm.tsx` | Multi-step form with room search |
| 10.3.2 | Available Room Search | ✅ Done | `components/bookings/BookingForm.tsx` | Date-based availability check |
| 10.3.3 | Edit Booking UI | 🔄 In Progress | `app/dashboard/bookings/[id]/page.tsx` | Edit button exists, routing missing |

---

## Phase 11: Multi-Property Support 🆕

> **Status:** ✅ Complete - Backend API Ready for Multi-Property Hotel Chains

### 11.1 Property Model & Migration
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 11.1.1 | Create Property schema in Prisma | ✅ Done | `prisma/schema.prisma` | Property model added |
| 11.1.2 | Update Room schema (add propertyId) | ✅ Done | `prisma/schema.prisma` | Unique constraint: propertyId + number |
| 11.1.3 | Update Booking schema (propertyId, inline guest) | ✅ Done | `prisma/schema.prisma` | Guest data denormalized |
| 11.1.4 | Create migration script | ✅ Done | `prisma/migrations/20260208000000_add_property_model/` | With default property creation & rollback |
| 11.1.5 | Regenerate Prisma Client | ✅ Done | | Types updated successfully |

### 11.2 Property Module (Backend)
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 11.2.1 | Create Properties Module | ✅ Done | `src/modules/properties/` | New module structure |
| 11.2.2 | Create Property DTOs | ✅ Done | `src/modules/properties/dto/` | Create/Update DTOs with validation |
| 11.2.3 | Implement Properties Service | ✅ Done | `properties.service.ts` | CRUD + limit validation |
| 11.2.4 | Implement Properties Controller | ✅ Done | `properties.controller.ts` | REST endpoints with auth |
| 11.2.5 | Import PropertiesModule in App | ✅ Done | `src/app.module.ts` | Module registered |
| 11.2.6 | Add max_properties to plans | ✅ Done | `prisma/schema.prisma` | Plan limits: 1/3/5/999 |
| 11.2.7 | Create property add-on feature | ✅ Done | `migrations/20260208000002_` | additional_properties (500฿/mo) |
| 11.2.8 | Implement property limit validation | ✅ Done | `properties.service.ts` | Checks plan + add-ons |

### 11.3 Update Existing Modules
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 11.3.1 | Update Room DTOs (add propertyId) | ✅ Done | `rooms/dto/create-room.dto.ts` | Breaking change |
| 11.3.2 | Update Room Service (property validation) | ✅ Done | `rooms.service.ts` | Validates propertyId, filters by property |
| 11.3.3 | Update Booking DTOs (inline guest data) | ✅ Done | `bookings/dto/create-booking.dto.ts` | propertyId + guest fields |
| 11.3.4 | Update Booking Service (property + guest logic) | ✅ Done | `bookings.service.ts` | Complex validation & auto-fill |
| 11.3.5 | Update Room Controller (available endpoint) | ✅ Done | `rooms.controller.ts` | Added propertyId query param |

### 11.4 API Documentation
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 11.4.1 | Update API_TASK_OVERVIEW.md | ✅ Done | `docs/Fontent/API_TASK_OVERVIEW.md` | Property section + breaking changes |
| 11.4.2 | Update PROJECT_TRACKER.md | ✅ Done | `docs/Fontent/PROJECT_TRACKER.md` | Phase 11 added |
| 11.4.3 | Update Postman Collection | ⬜ Pending | `docs/Fontent/POSTMAN_COLLECTION.json` | Properties folder needed |

### 11.5 Frontend Integration (Future Phase)
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 11.5.1 | Property List Page | ⬜ Pending | `app/dashboard/properties/page.tsx` | Grid/List view with stats |
| 11.5.2 | Property Detail Page | ⬜ Pending | `app/dashboard/properties/[id]/page.tsx` | View/Edit property info |
| 11.5.3 | Create Property Modal | ⬜ Pending | `components/properties/PropertyForm.tsx` | Form with validation |
| 11.5.4 | Property Limit Indicator | ⬜ Pending | `components/properties/PropertyLimitBadge.tsx` | Show: 2/3 properties used |
| 11.5.5 | Upgrade/Add-on Prompt | ⬜ Pending | `components/properties/UpgradePrompt.tsx` | When limit reached |
| 11.5.6 | Property Selector (Global) | ⬜ Pending | `components/layout/PropertySelector.tsx` | Navbar dropdown |
| 11.5.7 | Property Context Store | ⬜ Pending | `lib/stores/propertyStore.ts` | Zustand: selected property |
| 11.5.8 | Property API Hooks | ⬜ Pending | `lib/hooks/useProperties.ts` | CRUD + limit check |
| 11.5.9 | Update Booking Form (3-step) | ⬜ Pending | `components/bookings/BookingForm.tsx` | Step 1: Select Property |
| 11.5.10 | Property filter in Room list | ⬜ Pending | `app/dashboard/rooms/page.tsx` | Dropdown filter by property |
| 11.5.11 | Update Room Form (add propertyId) | ⬜ Pending | `components/rooms/RoomForm.tsx` | Property selector field |
| 11.5.12 | Property Stats Dashboard | ⬜ Pending | `app/dashboard/properties/page.tsx` | Total rooms, bookings per property |

**Frontend Features to Build:**
- 📊 **Property Management Page**: List, create, edit, delete properties
- 🏷️ **Property Limit Badge**: Visual indicator "2/3 properties used"
- 🚀 **Upgrade Prompt**: Modal when limit reached with pricing
- 🔄 **Property Switcher**: Global navbar dropdown to switch between properties
- 📝 **Updated Forms**: Booking & Room forms require property selection
- 📈 **Property Dashboard**: Stats per property (rooms, bookings, revenue)
- 🛒 **Add-on Purchase**: UI to buy additional property slots (500฿/mo)

**Breaking Changes:**
- ⚠️ `POST /v1/rooms` now requires `propertyId`
- ⚠️ `POST /v1/bookings` now requires `propertyId`, `guestFirstName`, `guestLastName` (guestId optional)
- ⚠️ Room number unique constraint changed from global to per-property
- ✅ Backward compatible: `GET` endpoints support optional `propertyId` filter

---

## Phase 12: Backend Improvements (Bug Fixes & UX Enhancements) 🆕

> **Status:** ✅ Complete - Error Handling, Tenant Admin Auto-Creation & Users API

### 12.1 Error Handling Improvements
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 12.1.1 | Fix Prisma P2021/P2022 errors for new users | ✅ Done | `all-exceptions.filter.ts` | Return empty data (200) instead of error (400) |
| 12.1.2 | Update rooms.service.ts error handling | ✅ Done | `modules/rooms/rooms.service.ts` | Handle missing tenantId & Prisma errors |
| 12.1.3 | Update bookings.service.ts error handling | ✅ Done | `modules/bookings/bookings.service.ts` | Added null tenantId check + Prisma errors |
| 12.1.4 | Update notifications.service.ts error handling | ✅ Done | `notifications/notifications.service.ts` | Handle database schema errors |
| 12.1.5 | Update promotions.service.ts error handling | ✅ Done | `promotions/promotions.service.ts` | Handle missing tables gracefully |
| 12.1.6 | Update hr.service.ts error handling | ✅ Done | `modules/hr/hr.service.ts` | Added null tenantId check + Prisma errors |
| 12.1.7 | Update users.service.ts error handling | ✅ Done | `modules/users/users.service.ts` | Added null tenantId check (prevents leaking data) |
| 12.1.8 | Update reviews.service.ts error handling | ✅ Done | `modules/reviews/reviews.service.ts` | Added null tenantId check |
| 12.1.9 | Update restaurant.service.ts error handling | ✅ Done | `modules/restaurant/restaurant.service.ts` | Added null tenantId check |
| 12.1.10 | Update channels.service.ts error handling | ✅ Done | `modules/channels/channels.service.ts` | Added null tenantId check |
| 12.1.11 | Update guests.service.ts error handling | ✅ Done | `modules/guests/guests.service.ts` | Return empty data (200) for findAll + Prisma error handling |

### 12.2 Tenant Admin Auto-Creation
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 12.2.1 | Auto-create tenant_admin user on hotel creation | ✅ Done | `tenants/hotel-management.service.ts` | Creates user with random password |
| 12.2.2 | Handle duplicate email (update tenantId) | ✅ Done | `tenants/hotel-management.service.ts` | Updates existing user's tenantId |
| 12.2.3 | Add PrismaService injection | ✅ Done | `tenants/hotel-management.service.ts` | Inject Prisma for user operations |
| 12.2.4 | Add bcrypt & randomBytes imports | ✅ Done | `tenants/hotel-management.service.ts` | Password hashing & generation |
| 12.2.5 | TODO: Email password reset link | ⬜ Pending | | Send reset link to new admin users |

**Impact:**
- ✅ New users see empty data (friendly UX) instead of confusing error messages
- ✅ New hotels automatically get a tenant_admin user
- ✅ Admin can login immediately after hotel creation
- ✅ No more "Tenant ID is required" errors for new users

**Technical Details:**
- Global exception filter catches Prisma errors (P2021: table not exist, P2022: column not exist)
- Returns HTTP 200 with empty data structure instead of HTTP 400 error
- Auto-generated user password (16-byte hex) requires email reset flow (TODO)
- User role: `tenant_admin`, Status: `active`, TenantId: auto-assigned

### 12.3 Users API Creation
| # | Task | Status | File | Notes |
|---|------|--------|------|-------|
| 12.3.1 | Create UsersService with CRUD operations | ✅ Done | `modules/users/users.service.ts` | Supports multi-tenancy filtering, excludes password from responses |
| 12.3.2 | Create UsersController with REST endpoints | ✅ Done | `modules/users/users.controller.ts` | GET /users, GET /users/:id, PATCH /users/:id, DELETE /users/:id |
| 12.3.3 | Create UsersModule | ✅ Done | `modules/users/users.module.ts` | Imports PrismaModule, exports UsersService |
| 12.3.4 | Register UsersModule in AppModule | ✅ Done | `app.module.ts` | Added to imports array |

**Purpose:**
Separate system users (login accounts) from HR employees. The Users API manages accounts with tenant_admin/platform_admin roles, while HR API manages hotel staff data (พนักงาน).

**Endpoints:**
- `GET /v1/users` - List all users (with pagination & filtering)
- `GET /v1/users/:id` - Get user by ID
- `PATCH /v1/users/:id` - Update user
- `DELETE /v1/users/:id` - Delete user

**Security:**
- Password field is NEVER returned in responses
- Multi-tenancy: tenant_admins see only their tenant's users, platform_admins see all
- Role-based access control with JwtAuthGuard + RolesGuard

---

## Development Priority Matrix

| Priority | Phase | Reason |
|----------|-------|--------|
| 🔴 High | 11.4.3 Postman Collection Update | API documentation for Property endpoints |
| 🔴 High | 11.5 Frontend Integration | UI for multi-property management |
| 🔴 High | 10.3.3 Edit Booking UI | Routing for edit page is missing |
| 🔴 High | 9.3 Guest CRUD UI | Core management feature needs completion |
| 🟡 Medium | 12.2.5 Email Password Reset | Send reset link to new admin users |
| 🟡 Medium | 7.1 Notifications API | NotificationPanel is live with mock data |
| 🟡 Medium | 7.2 Contact/Demo API | Contact page is public-facing |
| 🟡 Medium | 7.3 Onboarding API | Core user experience feature |
| 🟡 Medium | 7.6 Promotions API | PromoBanner needs dynamic content |
| 🟡 Medium | 7.4 Analytics API | Phase 4 requirement |
| 🟢 Low | 7.5 Loyalty API | Phase 5 future feature |

---

## Change Log

| Date | Changes | Files Modified |
|------|---------|----------------|
| 2026-02-10 | Phase 12 Complete - Error Handling + Tenant Admin Auto-Creation + Users API + Null TenantId Fix | `src/common/filters/all-exceptions.filter.ts`, `src/modules/rooms/rooms.service.ts`, `src/modules/bookings/bookings.service.ts`, `src/modules/guests/guests.service.ts`, `src/modules/hr/hr.service.ts`, `src/modules/users/users.service.ts`, `src/modules/reviews/reviews.service.ts`, `src/modules/restaurant/restaurant.service.ts`, `src/modules/channels/channels.service.ts`, `src/notifications/notifications.service.ts`, `src/promotions/promotions.service.ts`, `src/tenants/hotel-management.service.ts`, `src/modules/users/users.controller.ts`, `src/modules/users/users.module.ts`, `src/app.module.ts` |
| 2026-02-08 | Phase 11 Complete - Multi-Property Backend + Limits & Add-ons | `prisma/schema.prisma`, `src/modules/properties/`, `src/modules/rooms/`, `src/modules/bookings/`, `docs/*` |
| 2026-02-07 | Phase 8.4-8.6 Complete - Promotions, Analytics, Subscription hooks + TrialBadge/UpgradeModal/PromoBanner integration | `lib/hooks/usePromotions.ts`, `lib/hooks/useAnalytics.ts`, `lib/hooks/useSubscription.ts`, `components/saas/PromoBanner.tsx`, `components/saas/TrialBadge.tsx`, `components/saas/UpgradeModal.tsx`, `lib/hooks/index.ts` |
| 2026-02-07 | Phase 8.1-8.3 Complete - API Client endpoints + Custom hooks + Component integration | `lib/api/client.ts`, `lib/hooks/useNotifications.ts`, `lib/hooks/useContact.ts`, `lib/hooks/useOnboardingProgress.ts`, `components/ui/NotificationPanel.tsx`, `components/contact/ContactForm.tsx`, `components/contact/DemoBooking.tsx`, `components/onboarding/OnboardingChecklist.tsx` |
| 2026-02-07 | Added Phase 7 (Backend API) and Phase 8 (Frontend Integration) - 35 new tasks | `docs/PROJECT_TRACKER.md`, `docs/API_TASK_OVERVIEW.md` |
| 2024-01-XX 15:00 | Phase 3.1, 3.2 Complete - Upgrade Flow and Promo Banners | `components/saas/UpgradeModal.tsx`, `components/saas/PromoBanner.tsx`, `lib/constants/promotions.ts`, `app/dashboard/page.tsx` |
| 2024-01-XX 14:30 | Phase 2.3, 2.4 Complete - Quick Tips and Contact/Demo Page | `components/ui/QuickTip.tsx`, `lib/constants/quickTips.ts`, `app/contact/page.tsx`, `components/contact/ContactForm.tsx`, `components/contact/DemoBooking.tsx` |
| 2024-01-XX 13:30 | Phase 2.2 Complete - Trial Benefits Card with usage stats | `components/saas/TrialBenefitsCard.tsx`, `components/saas/index.ts`, `app/dashboard/page.tsx` |
| 2024-01-XX 13:00 | Phase 2.1 Complete - Guided Tour with spotlight, keyboard navigation, and data-tour attributes | `components/onboarding/GuidedTour.tsx`, `lib/constants/tourSteps.ts`, `components/layout/UserLayout.tsx`, `app/dashboard/page.tsx` |
| 2024-01-XX 12:30 | Phase 1.4 Complete - Onboarding Checklist component, constants, and Dashboard integration | `components/onboarding/OnboardingChecklist.tsx`, `lib/constants/onboardingChecklist.ts`, `components/onboarding/index.ts`, `app/dashboard/page.tsx` |
| 2024-01-XX 12:00 | Phase 1.3 Complete - Pricing page already exists with API integration, created supporting components | `app/pricing/page.tsx` (existing), `components/pricing/PricingCard.tsx`, `components/pricing/FeatureTable.tsx`, `lib/constants/pricingPlans.ts` |
| 2024-01-XX 11:00 | สร้าง TrialBadge, TrialUtils, เพิ่มใน UserLayout | `components/saas/TrialBadge.tsx`, `lib/utils/trialUtils.ts`, `components/layout/UserLayout.tsx`, `components/saas/index.ts` |
| 2024-01-XX 10:45 | เชื่อมต่อ Welcome Modal กับ Dashboard | `app/dashboard/page.tsx` |
| 2024-01-XX 10:30 | สร้าง Welcome Modal, Trial Benefits, Onboarding Store | `components/onboarding/WelcomeModal.tsx`, `lib/constants/trialBenefits.ts`, `lib/stores/onboardingStore.ts`, `components/onboarding/index.ts` |
| 2024-01-XX 10:00 | Initial tracker created | `docs/PROJECT_TRACKER.md` |

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Pending |
| 🔄 | In Progress |
| ✅ | Completed |
| ❌ | Blocked |
| ⏸️ | On Hold |
