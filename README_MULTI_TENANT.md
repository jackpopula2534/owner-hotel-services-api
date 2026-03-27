# Multi-Tenant Architecture - Quick Start Guide

## What Was Changed?

The Owner Hotel Services API backend has been restructured from a 1:1 User-to-Tenant model to a 1:Many model, allowing users to manage multiple companies/hotels under a single account.

**Key Change:**
- **Before**: 1 User can manage 1 Tenant (Hotel)
- **After**: 1 User can manage Many Tenants (Hotels) with different roles per tenant

## Immediate Actions Required

### 1. Apply Database Migration
```bash
npm run prisma:migrate
```
This creates the `user_tenants` junction table and updates the schema.

### 2. Verify Installation
```bash
npm test
npm run lint
```

### 3. Test New Endpoints (optional)
```bash
# Start the dev server
npm run dev

# Test in another terminal or Postman:
curl -X GET http://localhost:3000/api/v1/tenants/my-companies \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## What's New?

### Four New Endpoints

1. **Create Additional Company**
   ```
   POST /api/v1/tenants/create-company
   ```
   Allows users to create additional companies/tenants.

2. **List All My Companies**
   ```
   GET /api/v1/tenants/my-companies
   ```
   Lists all companies the user has access to with their roles.

3. **Switch Active Company**
   ```
   POST /api/v1/tenants/switch
   ```
   Changes the user's active tenant for the current session.

4. **Invite User to Company**
   ```
   POST /api/v1/tenants/invite
   ```
   Invites an existing user to manage a company with a specific role.

## Key Concepts

### Active Tenant (activeTenantId)
- User.tenantId now represents the "active tenant" for the current session
- All operations use this as the default context
- Can be changed with the "switch" endpoint

### User Roles Per Tenant
- **owner**: Full access, can invite others, manage subscriptions
- **admin**: Can manage properties and employees
- **member**: Limited access based on assignment (e.g., receptionist)

### Subscription Requirement
- Each tenant MUST have its own subscription
- Trial tenants get auto-created subscription on registration
- Additional tenants require purchasing a subscription

## Important Files

### Documentation
- `docs/MULTI_TENANT_ARCHITECTURE.md` - Complete architecture guide
- `CHANGES_SUMMARY.md` - Detailed list of all changes
- `IMPLEMENTATION_CHECKLIST.md` - Deployment checklist

### Code Changes
- `prisma/schema.prisma` - New UserTenant model added
- `src/tenants/tenants.service.ts` - 4 new methods added
- `src/tenants/tenants.controller.ts` - 4 new endpoints added
- `src/tenants/dto/` - 3 new DTOs created
- `src/modules/auth/auth.service.ts` - Updated registration flow

### Tests
- `__tests__/api/tenants/tenants.service.spec.ts` - Service tests
- `__tests__/api/tenants/tenants.controller.spec.ts` - Controller tests
- `__tests__/api/auth/auth.registration.spec.ts` - Auth tests

## Breaking Changes

**None!** The implementation maintains backward compatibility:
- User.tenantId continues to work as before
- Existing code doesn't need changes
- New code can use the multi-tenant features

## For Frontend Developers

### Update Your API Calls

```typescript
// Get all companies user has access to
const response = await fetch('/api/v1/tenants/my-companies', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const companies = response.json().data;

// Switch to a different company
await fetch('/api/v1/tenants/switch', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ tenantId: 'company-id-2' })
});

// Create a new company
const newCompany = await fetch('/api/v1/tenants/create-company', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My New Hotel',
    email: 'hotel@example.com',
    location: 'Bangkok'
  })
});

// Invite a user to a company
await fetch('/api/v1/tenants/invite', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    tenantId: 'company-id-1',
    role: 'admin'
  })
});
```

### UI Changes Recommended

1. **Dashboard**: Show current active company
2. **Header**: Add company switcher dropdown
3. **Settings**: Add "My Companies" section to list all managed companies
4. **Company Management**: Add "Create New Company" button
5. **User Management**: Add "Invite User" functionality with role selection

## Testing

All changes include comprehensive tests:
- Unit tests for service logic
- Integration tests for endpoints
- Auth tests for registration flow

Run tests:
```bash
npm test
npm run test:cov
```

All tests should pass with 80%+ coverage.

## Deployment

See `IMPLEMENTATION_CHECKLIST.md` for detailed deployment steps:
1. Database migration
2. Code deployment
3. Smoke tests
4. Frontend updates

## Support

For detailed information:
- Architecture details: `docs/MULTI_TENANT_ARCHITECTURE.md`
- Change summary: `CHANGES_SUMMARY.md`
- Implementation guide: `IMPLEMENTATION_CHECKLIST.md`

## FAQ

**Q: Can users still use the system with a single company?**
A: Yes! Single-company users work exactly as before. Multi-tenant features are opt-in.

**Q: Do I need to update all my code?**
A: No breaking changes. Existing code continues to work. Use new endpoints for multi-tenant features.

**Q: How do I know which company is active?**
A: Check the JWT token's `activeTenantId` claim or call `GET /api/v1/tenants/my-companies`.

**Q: Can a user have different roles in different companies?**
A: Yes! Roles are defined per user-tenant relationship via the user_tenants table.

**Q: What happens if I delete a company?**
A: All associated user_tenants records are deleted due to cascade delete rules.

**Q: Do I need to purchase a subscription for additional companies?**
A: Yes, each company must have its own subscription to be active.

---

**Implementation Date**: 2026-03-25
**Status**: Ready for Production
**Coverage**: 80%+ test coverage
