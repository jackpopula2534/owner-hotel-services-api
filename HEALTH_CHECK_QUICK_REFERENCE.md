# Health Check & Rate Limiting - Quick Reference

## Health Check Endpoints

### 1. Liveness Probe - GET /api/v1/health
```bash
curl http://localhost:3000/api/v1/health

# Response (200 OK):
{
  "status": "ok",
  "timestamp": "2026-03-23T10:30:00.000Z",
  "uptime": 1234.56,
  "version": "1.0.0"
}
```

**Use Case:** Kubernetes liveness probes, load balancer health checks
**Response Time:** < 10ms
**No rate limiting**

### 2. Readiness Probe - GET /api/v1/health/ready
```bash
curl http://localhost:3000/api/v1/health/ready

# Response (200 OK - All dependencies up):
{
  "status": "ok",
  "timestamp": "2026-03-23T10:30:00.000Z",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}

# Response (503 Service Unavailable - Database down):
{
  "statusCode": 503,
  "message": "Service unavailable - critical dependencies are down",
  "status": "down",
  "timestamp": "2026-03-23T10:30:00.000Z",
  "checks": {
    "database": { "status": "down", "error": "Connection failed" },
    "redis": { "status": "up" }
  }
}

# Response (200 OK - Degraded status):
{
  "status": "degraded",
  "timestamp": "2026-03-23T10:30:00.000Z",
  "checks": {
    "database": { "status": "up" },
    "redis": { "status": "degraded", "note": "Cache service not available" }
  }
}
```

**Use Case:** Kubernetes readiness probes, deployment health checks
**Response Time:** 50-500ms (depends on database latency)
**No rate limiting**

---

## Rate Limiting Configuration

### Global Default
- **Limit:** 100 requests per 60 seconds per IP
- **Applied to:** All endpoints not explicitly decorated
- **Status Code:** 429 (Too Many Requests)

### Authentication Endpoints

| Endpoint | Limit | TTL | Notes |
|----------|-------|-----|-------|
| POST /auth/register | 5 | 60s | Prevents bot registration |
| POST /auth/login | 10 | 60s | Prevents credential stuffing |
| POST /auth/admin/login | 10 | 60s | Admin account protection |
| POST /auth/refresh | 30 | 60s | Token refresh requests |
| POST /auth/logout | 50 | 60s | Logout requests |
| POST /auth/forgot-password | 3 | 3600s | Account recovery protection |
| POST /auth/reset-password | 5 | 60s | Password reset protection |

### Booking Endpoints

| Endpoint | Limit | TTL | Notes |
|----------|-------|-----|-------|
| GET /bookings | 100 | 60s | Global default (read) |
| GET /bookings/:id | 100 | 60s | Global default (read) |
| POST /bookings | 20 | 60s | Create booking (write) |
| PUT /bookings/:id | 20 | 60s | Update booking (write) |
| POST /bookings/:id/checkin | 100 | 60s | Global default |
| POST /bookings/:id/checkout | 100 | 60s | Global default |
| DELETE /bookings/:id | 10 | 60s | Delete booking (strictest) |

---

## Rate Limit Headers

When rate limited, the response includes:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1711181460
```

**Retry-After:** Seconds to wait before retrying

---

## Testing Rate Limits

### Test Login Rate Limiting
```bash
#!/bin/bash
for i in {1..15}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}' \
    -w "\nStatus: %{http_code}\n\n"
  sleep 1
done
# Should succeed for first 10, then get 429 on 11-15
```

### Test Booking Creation Limit
```bash
#!/bin/bash
TOKEN="your_jwt_token_here"
for i in {1..25}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/api/v1/bookings \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"guestId":"test","roomId":"test"}' \
    -w "\nStatus: %{http_code}\n\n"
  sleep 0.5
done
# Should succeed for first 20, then get 429 on 21-25
```

### Test Health Check Not Rate Limited
```bash
#!/bin/bash
for i in {1..200}; do
  curl -s http://localhost:3000/api/v1/health | \
    jq -r '.status' && sleep 0.1
done
# All 200 should succeed with status "ok"
```

---

## Implementation Files

### New Files (Created)
- `/src/health/health.module.ts` - Module definition
- `/src/health/health.controller.ts` - Endpoints (GET /health, GET /health/ready)
- `/src/health/health.service.ts` - Business logic (database + cache checks)
- `/src/health/health.controller.spec.ts` - Controller tests
- `/src/health/health.service.spec.ts` - Service tests
- `/src/health/RATE_LIMITING_REVIEW.md` - Detailed rate limiting analysis

### Modified Files
- `/src/app.module.ts` - Added HealthModule import and registration
- `/src/modules/auth/auth.controller.ts` - Added @Throttle() to logout endpoint
- `/src/modules/bookings/bookings.controller.ts` - Added @Throttle() to POST, PUT, DELETE endpoints

### Documentation Files
- `/IMPLEMENTATION_SUMMARY.md` - Complete implementation overview
- `/HEALTH_CHECK_QUICK_REFERENCE.md` - This file

---

## Kubernetes Configuration Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hotel-api
spec:
  template:
    spec:
      containers:
      - name: api
        image: hotel-api:latest
        ports:
        - containerPort: 3000

        # Liveness probe - restarts container if application is hung
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        # Readiness probe - removes from load balancer if not ready
        readinessProbe:
          httpGet:
            path: /api/v1/health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 5
          failureThreshold: 3
```

---

## Common Issues & Troubleshooting

### Issue: Health check returns 503 Service Unavailable
**Cause:** Database connection failed
**Solution:**
1. Check database is running
2. Verify DATABASE_URL environment variable
3. Check network connectivity to database

### Issue: Redis shows "degraded" status
**Cause:** Cache service not available
**Solution:**
1. Application can still function (read-only if cache fails)
2. Check Redis/cache service is running
3. Verify REDIS_URL or cache configuration
4. This is not critical - service still works

### Issue: Requests returning 429 Too Many Requests
**Cause:** Rate limit exceeded for that endpoint
**Solution:**
1. Check Retry-After header for wait time
2. Implement exponential backoff in client
3. Review if legitimate traffic or potential attack
4. Consider increasing limits in app.module.ts if legitimate high-volume use case

### Issue: Health checks not accessible
**Cause:** Controller not registered
**Solution:**
1. Verify HealthModule is imported in app.module.ts
2. Verify @Public() decorator allows unauthenticated access
3. Check @SkipThrottle() is applied
4. Review firewall/network configuration

---

## Performance Considerations

### Health Check Latency
- **GET /health:** ~5-10ms (no external calls)
- **GET /health/ready:** 50-500ms (depends on database response time)

### Rate Limit Performance
- Uses in-memory throttle store (default)
- For distributed systems, consider Redis-backed throttler
- Negligible overhead per request (~1-2ms per check)

### Caching
- Health status not cached (always fresh)
- For production, consider caching readiness check for 1-5 seconds
- Database connection pooling essential for health check performance

---

## Security Considerations

✅ No sensitive data in health check responses
✅ Error messages don't leak internal system details
✅ Health checks exempt from rate limiting (orchestration critical)
✅ Database checks use parameterized queries (no SQL injection)
✅ Cache checks timeout if service is unresponsive

---

## Next Steps

1. **Deployment:**
   - Run tests: `npm test`
   - Build: `npm run build`
   - Deploy to staging/production

2. **Monitoring:**
   - Set up alerts for degraded/down status
   - Monitor health check response times
   - Track rate limit violations

3. **Configuration:**
   - Consider environment variables for rate limits
   - Adjust limits based on actual traffic patterns
   - Document in team runbooks

4. **Testing:**
   - Write E2E tests for health endpoints
   - Add load testing to verify rate limits
   - Test failure scenarios (database down, cache down)

