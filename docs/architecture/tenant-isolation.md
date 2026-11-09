# Multi-Tenant Isolation Architecture

> Shipped: W2 of GO_LIVE_PLAN.md (2026-05-17 → 2026-05-30)

## What this protects against

The W1 production-readiness audit identified **325 Prisma calls** that fetched
or modified rows by `id` alone, with no `tenantId` filter in the `where`
clause. Each one is a potential cross-tenant data leak: a user from tenant A
who learns the `id` of a row owned by tenant B can read or modify it.

Multi-tenant isolation has two layers in StaySync now:

| Layer | Component | Catches |
|-------|-----------|---------|
| 1. HTTP request | `TenantGuard` (global `APP_GUARD`) | Cross-tenant attempts via URL params (`/hotels/:tenantId/...`) |
| 2. Prisma query | `tenant-scope.middleware` (global `$use`) | Cross-tenant attempts at the DB layer for ANY query on a scoped model |

Layer 2 is the meaningful one — Layer 1 is a defense-in-depth wrapper that
short-circuits obviously malicious requests before they hit the service code.

## How the Prisma layer works

```
┌─ Express request ──────────────────────────────────────────────────┐
│                                                                     │
│  TenantContextMiddleware  ─ opens an AsyncLocalStorage frame        │
│        │                    (tenantId = null, skipScope = false)    │
│        ▼                                                             │
│  JwtAuthGuard             ─ decodes JWT, attaches req.user          │
│        │                                                             │
│        ▼                                                             │
│  TenantContextInterceptor ─ mutates the ALS store with              │
│        │                    req.user.tenantId                       │
│        ▼                                                             │
│  Controller / Service                                               │
│        │                                                             │
│        ▼ this.prisma.booking.findMany({ where: { status: 'X' }})    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Prisma `$use` middleware                                    │   │
│  │   1. is "Booking" in TENANT_SCOPED_MODELS?           yes    │   │
│  │   2. is scope skipped?                                no    │   │
│  │   3. read tenantId from ALS                          "A"    │   │
│  │   4. inject:  where: { status:'X', tenantId:'A' }           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│        │                                                             │
│        ▼                                                             │
│  EncryptionService middleware (PDPA)                                │
│        │                                                             │
│        ▼                                                             │
│  MySQL — only rows belonging to tenant A returned                   │
└─────────────────────────────────────────────────────────────────────┘
```

The key insight is that **the developer writing the service never sees this**.
They keep writing `this.prisma.booking.findMany(...)` as before. The
middleware mutates the args invisibly. This is the right trade-off for a
325-call-site refactor: zero migration, full coverage.

## Files

| File | Purpose |
|------|---------|
| `tenant-context.service.ts` | AsyncLocalStorage wrapper |
| `tenant-context.middleware.ts` | Opens the per-request ALS frame (Express middleware) |
| `tenant-context.interceptor.ts` | Populates the frame after JwtAuthGuard runs (NestJS interceptor) |
| `tenant-scope.middleware.ts` | The Prisma `$use` callback that injects `tenantId` |
| `tenant-scoped-models.ts` | AUTO-GENERATED map of `ModelName → 'tenantId' \| 'tenant_id'` |
| `skip-tenant-scope.decorator.ts` | `@SkipTenantScope()` opt-out for platform-admin routes |
| `tenant.module.ts` | NestJS DI wiring |
| `tenant-scope.extension.ts` | Stub — see "Future migration" below |

## Operations covered

| Prisma op | Behaviour | Notes |
|-----------|-----------|-------|
| `findFirst`, `findFirstOrThrow` | inject `where.tenantId` | |
| `findUnique`, `findUniqueOrThrow` | **throws** | Call `findFirst({ where: { id, tenantId } })` instead — Prisma can't accept extra non-unique columns and we can't change op type from a middleware |
| `findMany` | inject `where.tenantId` | |
| `count`, `aggregate`, `groupBy` | inject `where.tenantId` | |
| `update`, `updateMany` | inject `where.tenantId` | |
| `delete`, `deleteMany` | inject `where.tenantId` | |
| `create` | default `data.tenantId` if missing | Caller can still set explicitly |
| `createMany` | default `data[].tenantId` per row | |
| `upsert` | inject both `where` and `create` | |

## Opt-out

Three escape hatches in priority order:

1. **`@SkipTenantScope()` route decorator** — for platform-admin endpoints
   that legitimately aggregate across tenants. The interceptor sets
   `skipScope = true` on the ALS frame, and the middleware passes through.

   ```typescript
   @SkipTenantScope()
   @Roles('platform_admin')
   @Get('admin/revenue-all-tenants')
   getRollup() { ... }
   ```

2. **`TenantContextService.runUnscoped()`** — for cron jobs and seeders
   that run outside an HTTP request.

   ```typescript
   await this.tenantContext.runUnscoped(async () => {
     await this.prisma.booking.findMany(); // no tenant filter
   });
   ```

3. **Model not in `TENANT_SCOPED_MODELS`** — platform/global/nested
   models pass through automatically. The set is auto-generated from
   `schema.prisma`; see `regenerate-tenant-scoped-models.sh`.

## Caveats / known limits

- **`findUnique` throws on scoped models** — intentional, see table above.
  About 30 call sites in the codebase use `findUnique` on tenant-scoped
  models; these need to migrate to `findFirst({ where: { id, tenantId } })`.
  Tracked as W3 item; the throw means broken code fails loud at test time
  rather than silently leaking.

- **Caller-supplied `where.tenantId` is honoured.** If a service explicitly
  sets `where: { tenantId: 'tenant-X' }` from controller-level input, the
  middleware does NOT overwrite it. This is correct for platform-admin
  workflows. Code review should flag any controller that reads `tenantId`
  from request body / params for a non-admin role.

- **Encryption runs AFTER scoping.** Registration order in `PrismaService`
  is tenant-scope first, encryption second. Otherwise we'd encrypt the
  filter value and the query would never match.

- **Bulk operations** like `prisma.$executeRaw\`UPDATE bookings SET ...\``
  bypass `$use` middleware entirely. Raw SQL needs manual `WHERE tenantId =`.
  Search the codebase for `$executeRaw|$queryRaw` and audit each one.

## Verifying isolation

Manual smoke test against staging:

```bash
# As tenant A
TOKEN_A=$(curl -s -X POST /api/v1/auth/login -d '{"email":"...","password":"..."}' | jq -r .accessToken)

# As tenant B
TOKEN_B=$(...)

# Find a booking ID from tenant B
BOOKING_B=$(curl -s -H "Authorization: Bearer $TOKEN_B" /api/v1/bookings | jq -r '.[0].id')

# Try to read it as tenant A — must return 404, not 200
curl -s -H "Authorization: Bearer $TOKEN_A" /api/v1/bookings/$BOOKING_B -w "HTTP=%{http_code}\n"
# Expected: HTTP=404
```

The unit test suite (`__tests__/tenant-scope.middleware.spec.ts`) verifies the
27 operation-level scenarios. The integration test (W2.6 — coming) covers the
end-to-end HTTP→DB path.

## Future migration: `$use` → `$extends`

Prisma 5 soft-deprecates `$use` in favour of `$extends`. We chose `$use` for
W2 because it requires zero migration of the 76 existing services. When
Prisma 6 removes `$use`:

1. Port the logic from `tenant-scope.middleware.ts` into
   `tenant-scope.extension.ts` (stubbed today).
2. Replace `this.$use(...)` in `PrismaService` with
   `return this.$extends(createTenantScopeExtension(...))`.
3. PrismaService becomes a factory that returns the extended client. Update
   the injection token consumers if any field on the extended client surfaces
   differently from the base.

Estimated effort: 1–2 days when needed.

## Maintenance

Whenever `prisma/schema.prisma` changes (new model added, model renamed,
`tenantId` field added/removed):

```bash
bash scripts/regenerate-tenant-scoped-models.sh
git diff src/common/tenant/tenant-scoped-models.ts
```

CI should fail if the file is out of sync — add this step to `.github/workflows/ci.yml`
when you wire up the schema-diff check (W3 stretch goal).
