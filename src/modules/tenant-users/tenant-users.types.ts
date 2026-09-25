import type { TerminalKey } from './terminal-registry';
import type { UserStatus } from './dto/list-tenant-users-query.dto';

/** ผู้เรียก API — มาจาก JWT (`@CurrentUser()`) + ip ของ request */
export interface ActorContext {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
  ip?: string;
}

export interface TerminalInfo {
  key: TerminalKey;
  name: string;
  nameTh: string;
  roles: { value: string; label: string }[];
  permissionCatalog: { code: string; label: string; group: string }[];
  defaultPermissions: Record<string, string[]>;
  requiresAddon: string | null;
  productLine: 'HOTEL' | 'CAMP' | null;
  available: boolean;
  userCount: number;
}

export interface TerminalGrant {
  terminal: TerminalKey;
  role: string;
  /** resolved (override ?? default) */
  permissions: string[];
  approvalLimit?: number | null;
  scopeIds?: string[] | null;
  grantedAt: string;
  grantedBy?: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  phone: string | null;
  primaryRole: string;
  status: UserStatus;
  employeeCode: string | null;
  hrEmployeeId: string | null;
  position: string | null;
  department: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  expiresAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
  isOwner: boolean;
  grants: TerminalGrant[];
}

export interface TenantUserStats {
  seatsUsed: number;
  maxUsers: number | null;
  byTerminal: Record<TerminalKey, number>;
  byStatus: Record<UserStatus, number>;
  neverLoggedIn: number;
  inactive90d: number;
  expiringSoon: number;
  without2fa: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorEmail: string | null;
  action: string;
  description: string | null;
  targetUserId: string | null;
  ipAddress: string | null;
}
