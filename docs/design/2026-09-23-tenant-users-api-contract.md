# tenant-users API contract (v1) — shared between backend & frontend

Base path: `/api/v1/tenant-users` (controller `@Controller({ path: 'tenant-users', version: '1' })`, same convention as `hotel-terminal/users`).
Auth: `JwtAuthGuard`; caller must have tenantId; write endpoints require role in
`tenant_admin | manager | MANAGER | platform_admin | admin`.
All responses wrap as `{ success: true, data: ... }` like the existing terminal-user modules.

## Terminal keys (backend `TERMINAL_REGISTRY`, src/modules/tenant-users/terminal-registry.ts)

| key              | nameTh          | roles (existing constants)                                              | requiresAddon        | productLine |
|------------------|-----------------|-------------------------------------------------------------------------|----------------------|-------------|
| `hotel-terminal` | ระบบจัดการโรงแรม | HOTEL_TERMINAL_ROLES (hotel_manager, front_desk, housekeeper, maintenance) | —                    | HOTEL       |
| `camp-terminal`  | ระบบลานกางเต็นท์ | camp_manager, camp_staff  (new, minimal)                                | —                    | CAMP        |
| `pos`            | Restaurant POS  | POS_ROLES (waiter, chef, cashier, kitchen_staff, restaurant_manager if exists) | RESTAURANT_MODULE | —      |
| `procurement`    | ระบบจัดซื้อ      | PROCUREMENT_ROLES                                                       | INVENTORY_MODULE     | —           |
| `warehouse`      | ระบบคลังสินค้า   | WAREHOUSE_ROLES                                                         | INVENTORY_MODULE     | —           |
| `retail`         | ระบบร้านค้า      | retail_manager, retail_cashier (new, minimal)                           | INVENTORY_MODULE     | —           |
| `accounting`     | ระบบบัญชี        | ACCOUNTING_ROLES                                                        | ACCOUNTING_MODULE    | —           |
| `crm`            | ระบบ CRM         | crm_manager, crm_agent (new, minimal)                                   | CRM_MODULE (if exists, else none) | — |
| `hr`             | ระบบ HR          | HR_ROLES                                                                | HR_MODULE            | —           |

Frontend maps these keys to `SUB_SYSTEMS[].id` in `lib/constants/subSystems.ts`:
`hotel-terminal→hotel-terminal`, `camp-terminal→camp-terminal`, `pos→pos`, `procurement→purchasing`,
`warehouse→warehouse`, `retail→retail-pos`, `accounting→accounting`, `crm→crm`, `hr→hr`.

`allowedSystems` sync: after every grant write, `users.allowedSystems` = JSON array of
(`'main'` if it was already present) ∪ (terminal keys of active grants). Never remove `'main'`.

## Types

```ts
type TerminalKey = 'hotel-terminal'|'camp-terminal'|'pos'|'procurement'|'warehouse'|'retail'|'accounting'|'crm'|'hr';

interface TerminalInfo {
  key: TerminalKey; name: string; nameTh: string;
  roles: { value: string; label: string }[];          // label = Thai
  permissionCatalog: { code: string; label: string; group: string }[];
  defaultPermissions: Record<string /*role*/, string[]>;
  requiresAddon: string | null; productLine: 'HOTEL'|'CAMP'|null;
  available: boolean;   // tenant's plan/addons allow it (false → 🔒 in UI)
  userCount: number;
}

interface TerminalGrant {
  terminal: TerminalKey; role: string; permissions: string[];   // resolved (override ?? default)
  approvalLimit?: number | null; scopeIds?: string[] | null;
  grantedAt: string; grantedBy?: string | null;
}

type UserStatus = 'active'|'suspended'|'inactive'|'expired';

interface TenantUser {
  id: string; email: string; firstName: string|null; lastName: string|null; fullName: string;
  phone: string|null; primaryRole: string; status: UserStatus;
  employeeCode: string|null;      // users.employeeId
  hrEmployeeId: string|null;      // from metadata.hrEmployeeId
  position: string|null;          // Employee.position if linked
  department: string|null;
  lastLoginAt: string|null; lastLoginIp: string|null;
  expiresAt: string|null; suspendedAt: string|null; suspendedReason: string|null;
  twoFactorEnabled: boolean; createdAt: string;
  isOwner: boolean;               // role tenant_admin → all terminals, read-only in matrix
  grants: TerminalGrant[];
}

interface TenantUserStats {
  seatsUsed: number; maxUsers: number | null;          // plans.max_users
  byTerminal: Record<TerminalKey, number>; byStatus: Record<UserStatus, number>;
  neverLoggedIn: number; inactive90d: number; expiringSoon: number /*≤7d*/; without2fa: number;
}

interface AuditEntry { id: string; createdAt: string; actorEmail: string|null; action: string;
  description: string|null; targetUserId: string|null; ipAddress: string|null; }
```

## Endpoints

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/tenant-users` | `?q=&terminal=&role=&status=&page=1&limit=25` | `{ data: TenantUser[], total, page, limit }` |
| GET | `/tenant-users/stats` | | `TenantUserStats` |
| GET | `/tenant-users/terminals` | | `TerminalInfo[]` |
| GET | `/tenant-users/matrix` | | `{ terminals: TerminalInfo[], users: TenantUser[] }` |
| GET | `/tenant-users/audit` | `?limit=50` | `AuditEntry[]` (tenant-wide, resource='user') |
| GET | `/tenant-users/importable-employees` | `?q=&department=&page=&limit=` | employees without a user account (reuse hotel-terminal-users logic, generic) |
| POST | `/tenant-users` | `{ email, password?, firstName?, lastName?, phone?, employeeCode?, hrEmployeeId?, grants: {terminal, role, permissions?}[], expiresAt?, generatePassword?: boolean }` | `TenantUser & { temporaryPassword?: string }` (409 email exists; 402/403 code `SEAT_LIMIT_REACHED` when seats full) |
| POST | `/tenant-users/import-employees` | `{ items: { hrEmployeeId, grants }[], defaultPassword }` | `{ created: TenantUser[], skipped: {hrEmployeeId, reason}[] }` |
| GET | `/tenant-users/:id` | | `TenantUser` |
| PATCH | `/tenant-users/:id` | `{ firstName?, lastName?, phone?, password?, expiresAt?: string|null }` | `TenantUser` |
| PUT | `/tenant-users/:id/access` | `{ grants: {terminal, role, permissions?}[] }` — full replace | `TenantUser` |
| POST | `/tenant-users/bulk-access` | `{ userIds: string[], grant?: {terminal, role}, revoke?: TerminalKey }` | `{ updated: number }` |
| POST | `/tenant-users/:id/suspend` | `{ reason: string }` | `TenantUser` (status suspended, all terminals) |
| POST | `/tenant-users/:id/activate` | | `TenantUser` |
| POST | `/tenant-users/:id/reset-password` | `{ password?: string }` | `{ temporaryPassword?: string }` |
| DELETE | `/tenant-users/:id` | | soft delete (status inactive, deactivatedAt) |
| GET | `/tenant-users/:id/audit` | | `AuditEntry[]` |

Rules: owner (`tenant_admin`) rows cannot be suspended/deleted/have access edited via this API (403).
Every write logs to `audit_logs` with resource `'user'`, category `'user-management'`,
actions: `user.create`, `user.update`, `user.access.grant`, `user.access.revoke`, `user.suspend`,
`user.activate`, `user.delete`, `user.password.reset`, `user.import`.
