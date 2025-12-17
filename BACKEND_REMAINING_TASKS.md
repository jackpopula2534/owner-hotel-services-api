# 📋 Backend Remaining Tasks

## สรุปส่วนที่ยังต้องทำในส่วนหลังบ้าน (Backend)

ตาม ARCHITECTURE_RECOMMENDATION.md และ IMPLEMENTATION_SUMMARY.md

---

## 🔴 Priority 1: Complete Core Modules

### 1. Channels Module ✅
**สถานะ:** ✅ เสร็จสมบูรณ์

**ทำเสร็จแล้ว:**
- ✅ Implement `ChannelsService` (CRUD operations + sync + toggleActive)
- ✅ Implement `ChannelsController` (endpoints)
- ✅ Create DTOs (`CreateChannelDto`, `UpdateChannelDto`)
- ✅ Add Prisma model for Channel
- ✅ Add sync endpoint for channel synchronization
- ⚠️ Add tests (ยังไม่ทำ)

**Endpoints ที่มี:**
- ✅ `GET /api/channels` - List channels
- ✅ `GET /api/channels/:id` - Get channel details
- ✅ `POST /api/channels` - Create channel
- ✅ `PATCH /api/channels/:id` - Update channel
- ✅ `DELETE /api/channels/:id` - Delete channel
- ✅ `POST /api/channels/:id/sync` - Sync channel data
- ✅ `PATCH /api/channels/:id/toggle-active` - Toggle active status

---

### 2. Reviews Module ✅
**สถานะ:** ✅ เสร็จสมบูรณ์

**ทำเสร็จแล้ว:**
- ✅ Implement `ReviewsService` (CRUD operations + stats + QR code)
- ✅ Implement `ReviewsController` (endpoints)
- ✅ Create DTOs (`CreateReviewDto`, `UpdateReviewDto`)
- ✅ Add statistics endpoint (average rating, review count, distribution)
- ✅ Add QR code generation for reviews
- ✅ Add findByQRCode and findByBookingId methods
- ⚠️ Add tests (ยังไม่ทำ)

**Endpoints ที่มี:**
- ✅ `GET /api/reviews` - List reviews
- ✅ `GET /api/reviews/:id` - Get review details
- ✅ `POST /api/reviews` - Create review
- ✅ `PATCH /api/reviews/:id` - Update review
- ✅ `DELETE /api/reviews/:id` - Delete review
- ✅ `GET /api/reviews/stats` - Get review statistics
- ✅ `GET /api/reviews/qr/:code` - Get review by QR code
- ✅ `GET /api/reviews/booking/:bookingId` - Get review by booking ID
- ✅ `POST /api/reviews/qr/generate` - Generate QR code for review

---

## 🟡 Priority 2: Security & Best Practices

### 3. Role-Based Access Control (RBAC) ⚠️
**สถานะ:** มี role ใน User model แต่ยังไม่มี guards/decorators

**ต้องทำ:**
- [ ] Create `RolesGuard` - Guard for role-based access
- [ ] Create `@Roles()` decorator - Decorator to specify required roles
- [ ] Create `@Public()` decorator - Decorator to mark public routes
- [ ] Update controllers to use role-based guards
- [ ] Add role validation in services (optional)
- [ ] Add tests

**Example:**
```typescript
// src/common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  // Implementation
}

// src/common/decorators/roles.decorator.ts
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

// Usage in controller:
@Roles('admin', 'manager')
@UseGuards(JwtAuthGuard, RolesGuard)
@Get()
async findAll() { ... }
```

---

### 4. Rate Limiting ⚠️
**สถานะ:** ยังไม่มี

**ต้องทำ:**
- [ ] Install `@nestjs/throttler`
- [ ] Configure `ThrottlerModule` in `app.module.ts`
- [ ] Add `@Throttle()` decorator to sensitive endpoints
- [ ] Configure rate limits (global and per-endpoint)
- [ ] Add tests

**Example:**
```typescript
// app.module.ts
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 10,
}),

// In controller:
@Throttle(5, 60) // 5 requests per 60 seconds
@Post('login')
async login() { ... }
```

---

### 5. Request Logging ⚠️
**สถานะ:** มี exception filter แต่ยังไม่มี request logging

**ต้องทำ:**
- [ ] Create `LoggingInterceptor` - Log all HTTP requests
- [ ] Add request/response logging
- [ ] Add request ID for tracing
- [ ] Configure log levels (development vs production)
- [ ] Add structured logging (JSON format)
- [ ] Optional: Add request logging to database

**Example:**
```typescript
// src/common/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const now = Date.now();
    
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const delay = Date.now() - now;
        console.log(`${method} ${url} ${statusCode} ${delay}ms - ${ip}`);
      }),
    );
  }
}
```

---

### 6. API Versioning ⚠️
**สถานะ:** มี version ใน Swagger แต่ไม่มี versioning ใน routes

**ต้องทำ:**
- [ ] Configure API versioning in `main.ts`
- [ ] Update all controllers to use version prefix
- [ ] Update Swagger to support multiple versions
- [ ] Add version strategy (URI, Header, or Query)
- [ ] Update frontend API client to use versioned endpoints

**Example:**
```typescript
// main.ts
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: '1',
});

// In controller:
@Controller({ path: 'guests', version: '1' })
export class GuestsController { ... }
```

---

## 🟢 Priority 3: Testing & Quality

### 7. Complete Unit Tests ⚠️
**สถานะ:** มีบางส่วนแล้ว (auth, guests) แต่ยังไม่ครบ

**ต้องทำ:**
- [ ] Complete unit tests for all services:
  - [ ] RoomsService
  - [ ] RestaurantService
  - [ ] HrService
  - [ ] ChannelsService (after implementation)
  - [ ] ReviewsService (after implementation)
- [ ] Complete unit tests for all controllers
- [ ] Add test coverage reporting
- [ ] Set minimum coverage threshold (80%)

---

### 8. Integration Tests ⚠️
**สถานะ:** มีบางส่วนแล้ว แต่ยังไม่ครบ

**ต้องทำ:**
- [ ] Integration tests for all modules
- [ ] Database integration tests
- [ ] Authentication flow tests
- [ ] End-to-end API tests

---

### 9. E2E Tests ⚠️
**สถานะ:** ยังไม่มี

**ต้องทำ:**
- [ ] Setup E2E testing framework
- [ ] Create E2E test suite
- [ ] Test complete user flows
- [ ] Test API integration with frontend

---

## 📊 Summary

### ✅ Completed
- ✅ Authentication Module (JWT, Refresh Token)
- ✅ Guests Module (CRUD)
- ✅ Bookings Module (CRUD)
- ✅ Rooms Module (CRUD + Status + Available)
- ✅ Restaurant Module (CRUD)
- ✅ HR Module (CRUD)
- ✅ Channels Module (CRUD + Sync + ToggleActive) - **เพิ่งเสร็จ**
- ✅ Reviews Module (CRUD + Stats + QR Code) - **เพิ่งเสร็จ**
- ✅ Basic Guards (JwtAuthGuard)
- ✅ Exception Filter
- ✅ CORS Configuration
- ✅ Swagger Documentation
- ✅ Basic Unit Tests (บางส่วน)

### ⚠️ In Progress / Remaining
- ⚠️ RBAC (0% - not implemented) - **Priority 2**
- ⚠️ Rate Limiting (0% - not implemented) - **Priority 2**
- ⚠️ Request Logging (0% - not implemented) - **Priority 2**
- ⚠️ API Versioning (0% - not implemented) - **Priority 2**
- ⚠️ Complete Unit Tests (30% - partial) - **Priority 3**
- ⚠️ Integration Tests (20% - partial) - **Priority 3**
- ⚠️ E2E Tests (0% - not implemented) - **Priority 3**

---

## 🎯 Recommended Implementation Order

1. ~~**Week 1:** Complete Channels & Reviews Modules~~ ✅ **เสร็จแล้ว**
2. **Week 2:** Implement RBAC & Rate Limiting
3. **Week 3:** Add Request Logging & API Versioning
4. **Week 4:** Complete Testing Suite

---

## 📝 สรุปส่วนที่เหลือ

### 🔴 Priority 2: Security & Best Practices (ยังต้องทำ)
1. **RBAC (Role-Based Access Control)** - 0%
2. **Rate Limiting** - 0%
3. **Request Logging** - 0%
4. **API Versioning** - 0%

### 🟢 Priority 3: Testing & Quality (ยังต้องทำ)
1. **Complete Unit Tests** - 30% (มีบางส่วน)
2. **Integration Tests** - 20% (มีบางส่วน)
3. **E2E Tests** - 0%

---

**วันที่อัปเดต:** 2024-12-17  
**สถานะ:** ✅ Core Modules Complete | ⚠️ Security & Testing Remaining

