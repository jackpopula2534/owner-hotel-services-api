# Multi-Tenant Architecture Documentation

## Overview

The Owner Hotel Services backend has been restructured to support a true multi-tenant architecture where users can manage multiple companies/hotels through a single account.

### Relationship Changes

**Before (1:1 Model):**
- 1 User → 1 Tenant (single company)
- User.tenantId directly references the tenant

**After (1:Many Model):**
- 1 User → Many Tenants (multiple companies) via `user_tenants` junction table
- User.tenantId = `activeTenantId` (current session context)
- 1 Tenant → 1 Subscription (every tenant MUST have its own subscription)
- 1 Tenant → Many Properties (limited by plan)

## Database Schema Changes

### New Model: UserTenant (Junction Table)

```prisma
model UserTenant {
  id        String   @id @default(uuid())
  userId    String   // FK → users.id
  tenantId  String   // FK → tenants.id
  role      String   @default("member")     // 'owner', 'admin', 'member'
  isDefault Boolean  @default(false)        // Which tenant is user's default
  joinedAt  DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user      User     @relation(fields: [userId], references: [id])
  tenant    tenants  @relation(fields: [tenantId], references: [id])

  @@unique([userId, tenantId])
  @@index([userId])
  @@index([tenantId])
  @@map("user_tenants")
}
```

### Modified Models

**User Model:**
- Added `userTenants UserTenant[]` relation
- `tenantId` field remains as `activeTenantId` (for current session context)

**Tenant Model:**
- Added `userTenants UserTenant[]` relation

## Registration Flow

1. User creates account (email, password, name)
2. System auto-creates first tenant (company)
3. System auto-creates trial subscription for that tenant
4. System creates `UserTenant` record with role='owner', isDefault=true
5. User receives JWT tokens with activeTenantId set

## Key Concepts

### Active Tenant (activeTenantId)

Each user always has an `activeTenantId` (stored in `User.tenantId` field) which represents their current session context. This is the tenant for which operations are performed by default.

### User Roles in Tenant

Users can have different roles per tenant:
- **owner**: Full access, can invite others, manage subscription
- **admin**: Can manage properties, employees, but not subscription
- **member**: Limited access, typically staff

### Subscription Requirement

Every tenant MUST have its own subscription:
- Trial tenants auto-created during registration get a free trial subscription
- Additional tenants created later require purchasing a subscription
- All operations on a tenant are blocked if subscription is expired

## New Endpoints

### Create Additional Company/Tenant

```
POST /api/v1/tenants/create-company
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Hotel B",
  "email": "hotel-b@example.com",
  "propertyType": "hotel",
  "location": "Bangkok",
  "taxId": "1234567890",
  ...
}

Response 201:
{
  "success": true,
  "data": {
    "id": "tenant-2",
    "name": "Hotel B",
    "status": "trial"
  },
  "message": "Company created successfully. Please purchase a subscription to activate it."
}
```

### Get All Accessible Tenants

```
GET /api/v1/tenants/my-companies
Authorization: Bearer <token>

Response 200:
{
  "success": true,
  "data": [
    {
      "id": "tenant-1",
      "name": "Hotel A",
      "status": "active",
      "userRole": "owner",
      "subscriptions": [...]
    },
    {
      "id": "tenant-2",
      "name": "Hotel B",
      "status": "trial",
      "userRole": "admin",
      "subscriptions": [...]
    }
  ],
  "meta": { "total": 2 }
}
```

### Switch Active Tenant

```
POST /api/v1/tenants/switch
Authorization: Bearer <token>
Content-Type: application/json

{
  "tenantId": "tenant-2"
}

Response 200:
{
  "success": true,
  "data": {
    "user": {
      "id": "user-1",
      "email": "test@example.com",
      "tenantId": "tenant-2"  // Updated activeTenantId
    },
    "message": "Tenant switched successfully"
  }
}
```

**Note:** After switching tenants, the user should request new JWT tokens to update the claim.

### Invite User to Tenant

```
POST /api/v1/tenants/invite
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "newuser@example.com",
  "tenantId": "tenant-1",
  "role": "admin"
}

Response 201:
{
  "success": true,
  "data": {
    "id": "ut-1",
    "userId": "user-2",
    "tenantId": "tenant-1",
    "role": "admin",
    "user": {
      "id": "user-2",
      "email": "newuser@example.com",
      "firstName": "Jane",
      "lastName": "Smith"
    }
  },
  "message": "User invited successfully"
}
```

## Service Methods

### TenantsService

#### createAdditionalTenant(userId, createCompanyDto)
- Creates a new tenant for an existing user
- Creates `user_tenants` record with role='owner'
- Does NOT auto-create subscription
- Returns new tenant object

#### getUserTenants(userId)
- Fetch all tenants for a given userId via `user_tenants` junction
- Includes subscription info for each tenant
- Returns array with userRole field for each tenant

#### switchTenant(userId, tenantId)
- Updates user's activeTenantId
- Validates user has access to tenant via `user_tenants`
- Returns updated user with new activeTenantId
- **Note:** Client must request new JWT tokens after switch

#### inviteUserToTenant(invitedByUserId, inviteDto)
- Adds a `user_tenants` record for an existing user with specified role
- Validates inviter has owner/admin role on the tenant
- Throws error if invitee already has access to tenant
- User must be registered first (cannot invite unregistered users)

### SubscriptionsService

#### requireActiveSubscription(tenantId)
- Checks if tenant has an active (non-trial, non-expired) subscription
- Returns boolean
- Used to enforce subscription requirement for all operations

## Authorization Rules

### Per-Tenant Authorization

All endpoints that operate on a specific tenant must verify:
1. User has entry in `user_tenants` table for that tenant
2. User's role allows the operation (owner, admin, member)
3. Tenant's subscription is active (for most operations)

### Implementation Pattern

```typescript
async operateOnTenant(userId: string, tenantId: string, operation: string) {
  // 1. Verify user has access to tenant
  const userTenant = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } }
  });

  if (!userTenant) {
    throw new ForbiddenException('No access to this tenant');
  }

  // 2. Verify role allows operation
  if (operation === 'delete' && !['owner', 'admin'].includes(userTenant.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }

  // 3. Verify subscription is active
  const hasActiveSubscription = await subscriptionsService.requireActiveSubscription(tenantId);
  if (!hasActiveSubscription) {
    throw new BadRequestException('Tenant subscription is not active');
  }

  // 4. Perform operation
  // ...
}
```

## Migration Guide

### For Existing Tenants

1. Run migration: `npm run prisma:migrate`
   - Creates `user_tenants` table
   - Adds `userTenants` relation to User and Tenant models

2. Data seeding (if needed):
   ```bash
   # Migrate existing user.tenantId → user_tenants records
   # This should be done via a seeder script to maintain data consistency
   ```

3. Update frontend:
   - Token now includes `activeTenantId` instead of `tenantId`
   - Add "My Companies" section to dashboard
   - Add tenant switcher UI
   - Add invite user UI

## Security Considerations

### Per-Tenant Data Isolation

All queries that operate on tenant-specific data must include tenantId filter:

```typescript
// Always include tenantId filter
const bookings = await prisma.booking.findMany({
  where: {
    tenantId: activeTenantId,  // Critical for multi-tenant isolation
  }
});
```

### Role-Based Access Control

- **owner**: Can invite others, manage subscription, modify tenant settings
- **admin**: Can manage properties, employees, view reports (no subscription management)
- **member**: Limited to assigned areas (e.g., receptionist can only check-in guests)

### Subscription Validation

Operations that create/modify significant resources require active subscription:
- Adding new properties
- Creating employee accounts
- Accepting bookings
- Running reports

## Testing Strategy

### Unit Tests

- `TenantsService.createAdditionalTenant()`
- `TenantsService.getUserTenants()`
- `TenantsService.switchTenant()`
- `TenantsService.inviteUserToTenant()`

### Integration Tests

- Registration creates user_tenants record with owner role
- Switching tenants updates activeTenantId
- Cannot switch to inaccessible tenant
- Cannot invite user without proper permissions
- Subscription validation blocks operations

### E2E Tests

- Full registration → create additional company → switch → invite workflow
- Permission enforcement across endpoints
- Subscription expiration handling

## Performance Considerations

### Indexing

The `user_tenants` junction table has:
- Unique constraint on (userId, tenantId)
- Indexes on userId and tenantId
- This supports O(1) lookups for tenant access verification

### Query Optimization

When fetching user tenants, use `include` to fetch subscription data in single query:

```typescript
await prisma.userTenant.findMany({
  where: { userId },
  include: {
    tenant: {
      include: {
        subscriptions: {
          include: { plans_subscriptions_plan_idToplans: true }
        }
      }
    }
  }
});
```

## Backward Compatibility

The User.tenantId field is retained as `activeTenantId`. Existing code that references `user.tenantId` continues to work but now represents the current session's active tenant rather than a permanent assignment.

New code should use:
- `user.tenantId` for current session context (activeTenantId)
- `user.userTenants` to access all assigned tenants
- `userTenant.role` to check permissions for specific tenant operations

## Future Enhancements

1. **Tenant Groups**: Multiple tenants under a parent company entity
2. **Cross-Tenant Reporting**: View aggregated metrics across multiple companies
3. **Advanced Roles**: Custom role definitions with specific permissions
4. **Tenant Sharing**: Temporary access sharing for consultants/auditors
5. **Subscription Pooling**: Combine licenses across multiple tenants
