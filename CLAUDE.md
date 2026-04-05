# CLAUDE.md — Owner Hotel Services API (Backend)

## Project Overview

ระบบจัดการโรงแรม SaaS (StaySync) — Backend API ใช้ NestJS 10 + TypeScript + Prisma ORM (MySQL)

## Tech Stack

- **Framework:** NestJS 10.x
- **ORM:** Prisma 5.x (MySQL)
- **Database Access Pattern:** PrismaService injected per module (multi-tenant aware)
- **Auth:** JWT + Passport.js + 2FA (Speakeasy)
- **Cache:** Redis (cache-manager-redis-store)
- **Queue:** Bull (Redis-backed job queue)
- **Real-time:** Socket.IO + WebSockets
- **Email:** @nestjs-modules/mailer + Handlebars templates
- **Notifications:** Firebase Admin SDK, LINE Notify
- **Validation:** class-validator + class-transformer
- **API Docs:** Swagger (@nestjs/swagger)
- **Testing:** Jest 29 + Supertest + integration-style service flow specs
- **Security Controls:** @nestjs/throttler global guard + endpoint-specific throttles on sensitive modules

## Project Structure

```
src/
├── modules/
│   ├── auth/                # Authentication & authorization
│   ├── users/               # User management
│   ├── guests/              # Guest profiles
│   ├── bookings/            # Reservation system
│   ├── rooms/               # Room inventory
│   ├── properties/          # Hotel properties
│   ├── housekeeping/        # Housekeeping tasks, room-ready flow
│   ├── staff/               # Housekeeping / maintenance staff management
│   ├── maintenance/         # Maintenance work orders and room status sync
│   ├── restaurant/          # F&B operations
│   ├── hr/                  # Human resources
│   ├── subscriptions/       # SaaS subscriptions
│   ├── plans/               # Pricing plans
│   ├── payments/            # Payment processing
│   ├── promptpay/           # PromptPay integration
│   ├── invoices/            # Billing
│   ├── notifications/       # System notifications
│   ├── push-notifications/  # Firebase push
│   ├── email/               # Email service
│   ├── analytics/           # Analytics tracking
│   ├── audit-log/           # Activity logging
│   ├── loyalty/             # Loyalty program
│   ├── promotions/          # Promotional campaigns
│   ├── channels/            # Distribution channels
│   ├── reports/             # Reporting
│   ├── reviews/             # Guest reviews
│   ├── admins/              # Admin users
│   ├── admin-panel/         # Admin dashboard backend
│   ├── two-factor-auth/     # 2FA security
│   ├── i18n/                # Internationalization
│   ├── mobile-api/          # Mobile endpoints
│   ├── cache/               # Cache operations
│   ├── tenants/             # Multi-tenancy
│   └── seeder/              # Database seeders
├── prisma/                  # Prisma service
├── database/                # Database config
└── common/                  # Shared utilities
```

## Recently Added Capabilities

- Time-aware booking creation with `scheduledCheckIn` / `scheduledCheckOut`
- Room availability calculation with cleaning buffer enforcement
- Housekeeping task lifecycle: create, assign, start, complete, inspect
- Maintenance task lifecycle with room status transitions
- Staff management module backed by Prisma models instead of mock data
- Audit logging for booking lifecycle and housekeeping task completion
- Integration coverage for booking -> checkout -> housekeeping room-ready flow

## Running the Project

```bash
npm run start:dev        # Start dev server (watch mode)
npm run build            # Compile TypeScript
npm run start:prod       # Production start
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration-pattern specs under src/integration
npm run test:e2e         # E2E tests
npm run test:cov         # Coverage report
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Prisma Studio UI
npm run seed             # Run database seeders
npm run db:refresh       # Refresh database
npm run lint             # ESLint with fix
```

## Development Guidelines

### Module Pattern (NestJS)
- ทุก feature เป็น module แยก ใน `src/modules/`
- แต่ละ module มี: controller, service, module, DTOs, entities
- ใช้ class-validator สำหรับ DTO validation
- ใช้ Prisma service สำหรับ database operations
- โมดูลที่กระทบ inventory/operations ควรระวัง room status transition (`available`, `occupied`, `cleaning`, `maintenance`)

### Path Alias
- `@/*` maps to `src/`

### Important Notes
- Prisma เป็น primary ORM (TypeORM อาจมีบ้างแต่ใช้ Prisma เป็นหลัก)
- MySQL database: `hotel_services_db`
- Redis สำหรับ caching + Bull queue
- Socket.IO สำหรับ real-time features
- Multi-tenant architecture (tenants module)
- Rate limiting via @nestjs/throttler
- Housekeeping/Maintenance endpoints มี per-route throttling เพิ่มจาก global default

## Security

- JWT authentication ผ่าน Passport.js
- 2FA support via Speakeasy
- ห้าม hardcode secrets — ใช้ ConfigModule + .env
- Validate DTOs ด้วย class-validator ทุก endpoint
- Rate limiting ทุก public endpoint
- Audit logging สำหรับ booking lifecycle และ housekeeping completion
