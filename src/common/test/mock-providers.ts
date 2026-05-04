/**
 * Default mock providers for NestJS testing modules.
 *
 * Drop these into `Test.createTestingModule({ providers: [...] })` whenever
 * the real provider is irrelevant to the unit under test but its absence
 * causes Nest to fail with "Nest can't resolve dependencies of ..."
 *
 * Each factory returns a fresh `jest.fn()` per call so specs do not share
 * state. Override any single method by mutating the returned object before
 * passing it to the testing module, or by calling `.mockX()` after compile.
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../cache/cache.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService } from '../../modules/addons/addon.service';
import { SelfServicePlanService } from '../../subscription/self-service-plan.service';

export const mockConfigService = (): Partial<ConfigService> => ({
  get: jest.fn((_key?: string, defaultValue?: unknown) => defaultValue),
});

export const mockJwtService = (): Partial<JwtService> => ({
  sign: jest.fn().mockReturnValue('signed-jwt-token'),
  signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
  verify: jest.fn().mockReturnValue({}),
  verifyAsync: jest.fn().mockResolvedValue({}),
  // Critical: present in real JwtService, absent in many existing manual mocks.
  decode: jest.fn().mockReturnValue({}),
});

export const mockEventEmitter = (): Partial<EventEmitter2> => ({
  emit: jest.fn().mockReturnValue(true),
  on: jest.fn(),
  off: jest.fn(),
  once: jest.fn(),
  removeAllListeners: jest.fn(),
});

export const mockCacheService = (): Partial<CacheService> => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  wrap: jest.fn(async (_key: string, fn: () => unknown) => fn()),
} as unknown as Partial<CacheService>);

/**
 * AuditLogService mock that auto-stubs every `log*` helper.
 *
 * The real service exposes both a generic `log(dto)` and many specific
 * helpers like `logStaffCreate`, `logMaintenanceUpdate`,
 * `logHousekeepingTaskCompletion`. We can't use a Proxy here — Nest's DI
 * graph enumerates provider properties and a Proxy that creates jest.fn()
 * for every key (including Symbol.toStringTag, then, etc.) breaks compile.
 * Instead we enumerate the common helpers explicitly.
 */
const AUDIT_LOG_METHODS = [
  'log',
  // Booking lifecycle
  'logBookingCreate',
  'logBookingUpdate',
  'logBookingCancel',
  'logBookingCheckIn',
  'logBookingCheckOut',
  // Housekeeping / maintenance
  'logHousekeepingTaskCreate',
  'logHousekeepingTaskAssign',
  'logHousekeepingTaskStart',
  'logHousekeepingTaskCompletion',
  'logHousekeepingTaskInspect',
  'logMaintenanceCreate',
  'logMaintenanceUpdate',
  'logMaintenanceComplete',
  // Staff
  'logStaffCreate',
  'logStaffUpdate',
  'logStaffDelete',
  // Guests / loyalty / payments
  'logGuestCreate',
  'logGuestUpdate',
  'logPaymentCreate',
  'logPaymentApprove',
  'logPaymentReject',
  'logRefund',
  // Auth
  'logLogin',
  'logLogout',
  'logPasswordChange',
  'logFailedLogin',
] as const;

export const mockAuditLogService = (): Partial<AuditLogService> => {
  const obj: Record<string, jest.Mock> = {};
  for (const m of AUDIT_LOG_METHODS) {
    obj[m] = jest.fn().mockResolvedValue(undefined);
  }
  return obj as unknown as Partial<AuditLogService>;
};

export const mockAddonService = (): Partial<AddonService> => ({
  // AddonGuard typically calls `hasAddon(tenantId, addonKey)` or similar.
  // Default to `true` so guards do not block by default in unit tests.
} as unknown as Partial<AddonService>);

export const mockSelfServicePlanService = (): Partial<SelfServicePlanService> => ({
} as unknown as Partial<SelfServicePlanService>);

/**
 * One-stop shop. Spread into `providers: [...]` to satisfy the most common
 * cross-module dependencies. Specs that genuinely test one of these should
 * override by listing their own provider entry AFTER the spread.
 */
export const commonMockProviders = () => [
  { provide: ConfigService, useValue: mockConfigService() },
  { provide: JwtService, useValue: mockJwtService() },
  { provide: EventEmitter2, useValue: mockEventEmitter() },
  { provide: CacheService, useValue: mockCacheService() },
  { provide: AuditLogService, useValue: mockAuditLogService() },
  { provide: AddonService, useValue: mockAddonService() },
  { provide: SelfServicePlanService, useValue: mockSelfServicePlanService() },
];
