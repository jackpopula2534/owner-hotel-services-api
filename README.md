# StaySync — Hotel Management SaaS (Backend API)

ระบบจัดการโรงแรม SaaS แบบ Multi-Tenant สำหรับ Backend API  
พัฒนาด้วย **NestJS 10** + **TypeScript** + **Prisma ORM** (MySQL)

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | NestJS 10.x |
| Language | TypeScript |
| ORM | Prisma 5.x |
| Database | MySQL (`hotel_services_db`) |
| Auth | JWT + Passport.js + 2FA (Speakeasy) |
| Cache | Redis (cache-manager-redis-store) |
| Queue | Bull (Redis-backed job queue) |
| Real-time | Socket.IO + WebSockets |
| Email | @nestjs-modules/mailer + Handlebars templates |
| Push Notifications | Firebase Admin SDK |
| External Notify | LINE Notify |
| Validation | class-validator + class-transformer |
| API Docs | Swagger (@nestjs/swagger) |
| Rate Limiting | @nestjs/throttler (global + per-route) |
| Testing | Jest 29 + Supertest |

---

## Project Structure

```
owner-hotel-services-api/
├── src/
│   ├── modules/
│   │   ├── auth/                # Authentication & authorization (JWT, 2FA)
│   │   ├── users/               # User management
│   │   ├── guests/              # Guest profiles
│   │   ├── bookings/            # Reservation system
│   │   ├── rooms/               # Room inventory & status
│   │   ├── properties/          # Hotel properties
│   │   ├── housekeeping/        # Housekeeping tasks & room-ready flow
│   │   ├── staff/               # Housekeeping/maintenance staff management
│   │   ├── maintenance/         # Maintenance work orders & room status sync
│   │   ├── restaurant/          # F&B operations
│   │   ├── hr/                  # Human resources
│   │   ├── subscriptions/       # SaaS subscriptions
│   │   ├── plans/               # Pricing plans
│   │   ├── payments/            # Payment processing
│   │   ├── promptpay/           # PromptPay integration
│   │   ├── invoices/            # Billing & invoices
│   │   ├── notifications/       # System notifications
│   │   ├── push-notifications/  # Firebase push notifications
│   │   ├── email/               # Email service
│   │   ├── analytics/           # Analytics tracking
│   │   ├── audit-log/           # Activity logging
│   │   ├── loyalty/             # Loyalty program
│   │   ├── promotions/          # Promotional campaigns
│   │   ├── channels/            # Distribution channels
│   │   ├── reports/             # Reporting
│   │   ├── reviews/             # Guest reviews
│   │   ├── admins/              # Admin users
│   │   ├── admin-panel/         # Admin dashboard backend
│   │   ├── two-factor-auth/     # 2FA security
│   │   ├── i18n/                # Internationalization
│   │   ├── mobile-api/          # Mobile endpoints
│   │   ├── cache/               # Cache operations
│   │   ├── tenants/             # Multi-tenancy
│   │   └── seeder/              # Database seeders
│   ├── prisma/                  # PrismaService
│   ├── database/                # Database config
│   └── common/                  # Shared utilities, guards, interceptors
│
├── prisma/
│   ├── schema.prisma            # Database schema
│   └── migrations/              # Migration files
│
├── __tests__/
│   ├── unit/                    # Service & utility tests
│   ├── integration/             # Controller + DB tests
│   └── e2e/                     # Full API flow tests
│
├── .env.example                 # Environment variable template
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MySQL
- Redis

### Installation

```bash
git clone <repository-url>
cd owner-hotel-services-api
npm install
```

### Environment Variables

คัดลอก `.env.example` แล้วสร้างไฟล์ `.env`:

```bash
cp .env.example .env
```

ตัวอย่าง environment variables ที่จำเป็น:

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/hotel_services_db"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# App
PORT=3000
NODE_ENV=development
```

> **หมายเหตุ:** ห้าม commit ไฟล์ `.env` เด็ดขาด — ใช้ `.env.example` เป็น template เท่านั้น

---

## Running

```bash
npm run start:dev        # Start dev server (watch mode)
npm run start:prod       # Start production server
npm run build            # Compile TypeScript
```

---

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Dev server (watch mode) |
| `npm run start:prod` | Production server |
| `npm run build` | TypeScript compile |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests |
| `npm run test:e2e` | E2E tests |
| `npm run test:cov` | Coverage report (min 80%) |
| `npm run lint` | ESLint with auto-fix |
| `npm run prisma:migrate` | Run Prisma migrations |
| `npm run prisma:studio` | Open Prisma Studio UI |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run seed` | Run database seeders |
| `npm run db:refresh` | Refresh database |

---

## API Design

### URL Structure

```
# Resources: nouns, plural, lowercase, kebab-case
GET    /api/v1/rooms
GET    /api/v1/rooms/:id
POST   /api/v1/rooms
PUT    /api/v1/rooms/:id
PATCH  /api/v1/rooms/:id
DELETE /api/v1/rooms/:id

# Sub-resources
GET    /api/v1/properties/:id/rooms
POST   /api/v1/guests/:id/bookings

# Actions (verbs สำหรับ operations พิเศษ)
POST   /api/v1/bookings/:id/check-in
POST   /api/v1/bookings/:id/check-out
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

### Response Format

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "limit": 20, "total": 100 }
}

// Error
{
  "success": false,
  "error": {
    "code": "BOOKING_NOT_FOUND",
    "message": "Booking with ID 123 not found"
  }
}
```

### Swagger Docs

เข้าถึงได้ที่ `http://localhost:3000/api/docs` เมื่อ run ใน dev mode

---

## Architecture

### Multi-Tenant

- แต่ละ hotel tenant มี isolated data ผ่าน `tenants` module
- PrismaService inject per module พร้อม tenant-aware queries
- Prisma middleware จัดการ soft delete + tenant isolation

### Module Pattern

```
modules/<feature>/
├── <feature>.module.ts         # Module definition
├── <feature>.controller.ts     # HTTP endpoints + Swagger decorators
├── <feature>.service.ts        # Business logic
├── dto/
│   ├── create-<feature>.dto.ts
│   └── update-<feature>.dto.ts
└── entities/                   # Prisma types or custom entities
```

### Room Status Flow

```
available ──► occupied (check-in)
occupied  ──► cleaning (check-out)
cleaning  ──► available (housekeeping complete)
available ──► maintenance (work order created)
maintenance ──► available (work order closed)
```

---

## Development Guidelines

### Service Pattern

```ts
// ✅ Business logic อยู่ใน service เท่านั้น
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBookingDto) {
    try {
      return await this.prisma.booking.create({ data: dto });
    } catch (error) {
      this.logger.error('Failed to create booking', error);
      throw new BadRequestException('Could not create booking');
    }
  }
}
```

### DTO Validation

```ts
// ใช้ class-validator เสมอ
export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  guestId: string;

  @ApiProperty()
  @IsDateString()
  checkIn: string;
}
```

### Database Transactions

```ts
// ใช้ prisma.$transaction() สำหรับ operations หลายขั้นตอน
await this.prisma.$transaction([
  this.prisma.booking.update({ where: { id }, data: { status: 'CHECKED_OUT' } }),
  this.prisma.room.update({ where: { id: roomId }, data: { status: 'cleaning' } }),
]);
```

---

## Testing

ทำตาม TDD workflow เสมอ:

1. **RED** — เขียน test ก่อน (ต้อง fail)
2. **GREEN** — เขียน implementation ให้ test ผ่าน
3. **REFACTOR** — ปรับปรุง code
4. **VERIFY** — coverage ต้องได้ 80%+

```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests
npm run test:integration    # Integration tests
npm run test:e2e            # E2E tests
npm run test:cov            # Coverage report
```

### Unit Test Pattern

```ts
describe('BookingsService', () => {
  let service: BookingsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [BookingsService, PrismaService],
    })
      .overrideProvider(PrismaService)
      .useValue(mockDeep<PrismaClient>())
      .compile();

    service = module.get(BookingsService);
    prisma = module.get(PrismaService);
  });

  it('should create booking', async () => {
    prisma.booking.create.mockResolvedValue(mockBooking);
    const result = await service.create(mockDto);
    expect(result).toEqual(mockBooking);
  });
});
```

---

## Security Checklist

ก่อน commit ทุกครั้งต้องตรวจสอบ:

- [ ] ไม่มี hardcoded secrets (API keys, passwords, DB credentials)
- [ ] Validate inputs ด้วย class-validator DTOs ทุก endpoint
- [ ] ป้องกัน SQL injection (ใช้ Prisma parameterized queries เสมอ)
- [ ] JWT Guards ทุก protected endpoint
- [ ] Role-based authorization ครบถ้วน
- [ ] Rate limiting เปิดอยู่บน public endpoints
- [ ] Error messages ไม่ leak stack traces หรือข้อมูล internal
- [ ] Audit logging สำหรับ sensitive operations

---

## Git Workflow

```
feat: add guest check-in notification endpoint
fix: resolve booking overlap validation in service
refactor: extract payment processing to separate service
test: add unit tests for subscription service
chore: update Prisma schema and run migration
```

Types: `feat` | `fix` | `refactor` | `docs` | `test` | `chore` | `perf` | `ci`

> **หมายเหตุ:** ถ้ามีการเปลี่ยน Prisma schema ต้อง run `npm run prisma:migrate` ก่อน merge เสมอ

---

## License

MIT
