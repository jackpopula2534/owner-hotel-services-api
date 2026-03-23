# Rate Limiting Configuration Review

## Current Status

The application has **ThrottlerModule** globally configured and **ThrottlerGuard** applied as a global APP_GUARD.

### Global Configuration (app.module.ts)
```typescript
ThrottlerModule.forRoot([
  {
    ttl: 60,        // 60 seconds window
    limit: 100,     // 100 requests per IP per window (global default)
  },
])
```

**Status: ADEQUATE** - Default global rate limit of 100 requests per 60 seconds per IP is reasonable for general endpoints.

---

## Authentication Endpoints Analysis

### File: src/modules/auth/auth.controller.ts

All auth endpoints have **EXCELLENT** rate limiting configuration:

#### ✅ `POST /auth/register`
- **Current Limit**: 5 requests per 60 seconds
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 5, ttl: 60 } })`
- **Status**: SECURE - Stricter than default, good brute-force protection

#### ✅ `POST /auth/login`
- **Current Limit**: 10 requests per 60 seconds
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 10, ttl: 60 } })`
- **Status**: SECURE - Stricter than default, prevents credential stuffing

#### ✅ `POST /auth/admin/login`
- **Current Limit**: 10 requests per 60 seconds
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 10, ttl: 60 } })`
- **Status**: SECURE - Same as user login, adequate for admin protection

#### ✅ `POST /auth/refresh`
- **Current Limit**: 30 requests per 60 seconds
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 30, ttl: 60 } })`
- **Status**: GOOD - Reasonable for legitimate token refresh operations

#### ✅ `POST /auth/forgot-password`
- **Current Limit**: 3 requests per 3600 seconds (1 hour)
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 3, ttl: 3600 } })`
- **Status**: EXCELLENT - Strict protection against password reset abuse

#### ✅ `POST /auth/reset-password`
- **Current Limit**: 5 requests per 60 seconds
- **Decorators**: `@Public()`, `@Throttle({ default: { limit: 5, ttl: 60 } })`
- **Status**: GOOD - Prevents brute-force token validation attempts

#### ❌ `POST /auth/logout`
- **Current Limit**: Global default (100 per 60 seconds)
- **Decorators**: `@UseGuards(JwtAuthGuard)` - MISSING `@Throttle()` decorator
- **Recommendation**: Add `@Throttle({ default: { limit: 50, ttl: 60 } })` for consistency

---

## Bookings Controller Analysis

### File: src/modules/bookings/bookings.controller.ts

**Current Status**: NO CUSTOM RATE LIMITING - All endpoints use global default (100 per 60 seconds)

All endpoints are protected by `@UseGuards(JwtAuthGuard, RolesGuard)` which is GOOD for authentication but lacks granular rate limiting.

#### Endpoints without custom rate limiting:
- `GET /bookings` - List all bookings
- `GET /bookings/:id` - Get specific booking
- `POST /bookings` - Create booking (write operation - CRITICAL)
- `PUT /bookings/:id` - Update booking (write operation - CRITICAL)
- `POST /bookings/:id/checkin` - Check-in operation
- `POST /bookings/:id/checkout` - Check-out operation
- `DELETE /bookings/:id` - Cancel/delete booking (write operation - CRITICAL)

#### ⚠️ Recommendations:

**Read Operations** (GET):
```typescript
@Get()
@Throttle({ default: { limit: 100, ttl: 60 } }) // Keep at global default
async findAll() { }
```

**Write Operations** (POST, PUT, DELETE) - SHOULD BE MORE STRICT:
```typescript
@Post()
@Throttle({ default: { limit: 20, ttl: 60 } }) // 20 requests per minute
async create() { }

@Put(':id')
@Throttle({ default: { limit: 20, ttl: 60 } })
async update() { }

@Delete(':id')
@Throttle({ default: { limit: 10, ttl: 60 } }) // Extra strict for deletions
async remove() { }
```

---

## Health Check Endpoints

### File: src/health/health.controller.ts (NEW)

**Status: EXCELLENT**

Both health check endpoints use `@SkipThrottle()` decorator:
- `GET /health` - Liveness check
- `GET /health/ready` - Readiness check

This is correct because:
1. Health checks are lightweight (no complex operations)
2. Used by orchestration systems (Kubernetes, Docker Compose, load balancers)
3. Need to be frequently called without rate limits
4. Public endpoints that must be immediately responsive

---

## Summary of Issues Found

### CRITICAL
- None currently

### HIGH
- **Bookings Controller**: Write operations (POST, PUT, DELETE) should have stricter rate limits than global default

### MEDIUM
- **Auth Controller**: Logout endpoint should have explicit rate limit decorator for consistency

---

## Implementation Recommendations

### 1. Add Rate Limiting to Bookings Controller

```typescript
import { Throttle } from '@nestjs/throttler';

@Post()
@Throttle({ default: { limit: 20, ttl: 60 } })
@ApiOperation({ summary: 'Create a new booking' })
async create(@Body() createBookingDto: any) { }

@Put(':id')
@Throttle({ default: { limit: 20, ttl: 60 } })
@ApiOperation({ summary: 'Update booking' })
async update(@Param('id') id: string, @Body() updateBookingDto: any) { }

@Delete(':id')
@Throttle({ default: { limit: 10, ttl: 60 } })
@ApiOperation({ summary: 'Cancel booking' })
async remove(@Param('id') id: string) { }
```

### 2. Add Rate Limiting to Auth Logout Endpoint

```typescript
@Post('logout')
@Throttle({ default: { limit: 50, ttl: 60 } })
@UseGuards(JwtAuthGuard)
async logout() { }
```

### 3. Recommended Rate Limit Table for Common Operations

| Operation Type | Limit | Window | Reason |
|---|---|---|---|
| Health Checks | No limit | - | System/orchestration use |
| Login Attempts | 10/min | 60s | Brute-force protection |
| Password Reset | 3/hour | 3600s | Account security |
| Read Operations | 100/min | 60s | Default - reasonable for UI |
| Write Operations | 20/min | 60s | Database impact consideration |
| Delete Operations | 10/min | 60s | Irreversible - extra protection |
| Admin Actions | 5/min | 60s | Compliance auditing |

---

## Testing the Rate Limiting

### Manual Testing
```bash
# Test login rate limiting (should fail after 10 attempts)
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"user@test.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n"
done

# Test health check (should always succeed)
for i in {1..200}; do
  curl http://localhost:3000/api/health -w "%{http_code}\n"
done
```

### Automated Testing
```typescript
describe('Rate Limiting', () => {
  it('should rate limit login after 10 attempts', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(invalidCredentials)
        .expect(200); // Or 401 if auth fails
    }

    // 11th request should be rate limited
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(invalidCredentials);

    expect(response.status).toBe(429); // Too Many Requests
    expect(response.headers['retry-after']).toBeDefined();
  });
});
```

---

## Configuration Files to Review

1. `app.module.ts` - ThrottlerModule configuration ✅
2. `src/modules/auth/auth.controller.ts` - Auth rate limiting ✅
3. `src/modules/bookings/bookings.controller.ts` - Bookings rate limiting ⚠️
4. Environment variables for configurable limits (recommended)

---

## Next Steps

1. ✅ Health check module created with proper `@SkipThrottle()` configuration
2. ⚠️ Update Bookings controller to add explicit rate limits to write operations
3. ⚠️ Add explicit rate limit to Auth logout endpoint
4. Consider adding environment variable configuration for rate limits
5. Add integration tests for rate limiting behavior
6. Monitor actual traffic patterns and adjust limits based on real usage data

