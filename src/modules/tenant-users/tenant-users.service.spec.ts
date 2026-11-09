// bcrypt has a native binding that doesn't always load in CI sandboxes — stub it
// before the service module is required (same approach as the other user modules).
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TenantUsersService } from './tenant-users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService } from '../addons/addon.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { DEFAULT_WAREHOUSE_PERMISSIONS } from '../warehouse-users/dto/create-warehouse-user.dto';
import { DEFAULT_ACCOUNTING_PERMISSIONS } from '../accounting-users/dto/create-accounting-user.dto';
import { DEFAULT_HOTEL_TERMINAL_PERMISSIONS } from '../hotel-terminal-users/dto/create-hotel-terminal-user.dto';

const TENANT = 'tenant-1';
const ACTOR = { userId: 'admin-1', tenantId: TENANT, role: 'tenant_admin', ip: '127.0.0.1' };

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    email: 'staff@hotel.test',
    password: 'hashed',
    firstName: 'Som',
    lastName: 'Chai',
    phone: null,
    role: 'buyer',
    status: 'active',
    tenantId: TENANT,
    employeeId: null,
    metadata: null,
    allowedSystems: '["main","procurement"]',
    procurementPermissions: null,
    warehousePermissions: null,
    warehouseIds: null,
    approvalLimit: null,
    expiresAt: null,
    suspendedAt: null,
    suspendedBy: null,
    suspendedReason: null,
    deactivatedAt: null,
    lastLoginAt: null,
    lastLoginIp: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    userTerminalAccess: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user2FASettings: { findMany: jest.fn().mockResolvedValue([]) },
    employee: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('TenantUsersService', () => {
  let service: TenantUsersService;
  let prisma: ReturnType<typeof createMockPrisma>;
  const tenantContext = { runUnscoped: jest.fn((fn: () => unknown) => fn()) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const addonService = {
    getTenantSystem: jest.fn().mockResolvedValue('HOTEL'),
    getActiveAddons: jest.fn().mockResolvedValue([]),
  };
  const subscriptionsService = { findByTenantId: jest.fn().mockResolvedValue(null) };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: AuditLogService, useValue: auditLog },
        { provide: AddonService, useValue: addonService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();
    service = moduleRef.get(TenantUsersService);
  });

  // ── read-through fallback ─────────────────────────────────────────────────

  describe('read-through fallback (no user_terminal_access rows)', () => {
    it('derives grants from allowedSystems + role + legacy permission columns', async () => {
      const user = makeUser({
        role: 'buyer',
        allowedSystems: '["main","procurement","hotel-terminal"]',
        procurementPermissions: '["pr.create","rfq.create"]',
        approvalLimit: 75000,
        metadata: JSON.stringify({ hrEmployeeId: null, permissions: ['rooms.view'] }),
      });
      prisma.user.findFirst.mockResolvedValue(user);

      const res = await service.findOne('u-1', TENANT);

      expect(res.success).toBe(true);
      expect(res.data.grants).toHaveLength(2);
      const procurement = res.data.grants.find((g) => g.terminal === 'procurement');
      expect(procurement).toMatchObject({
        role: 'buyer',
        permissions: ['pr.create', 'rfq.create'],
        approvalLimit: 75000,
      });
      // role "buyer" is not a hotel-terminal role → first role of that terminal
      const hotel = res.data.grants.find((g) => g.terminal === 'hotel-terminal');
      expect(hotel).toMatchObject({ role: 'hotel_manager', permissions: ['rooms.view'] });
      expect(res.data.isOwner).toBe(false);
      expect(res.data.primaryRole).toBe('buyer');
    });

    it('falls back to the role default permissions when no legacy blob exists', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ role: 'front_desk', allowedSystems: '["main","hotel-terminal"]' }),
      );
      const res = await service.findOne('u-1', TENANT);
      expect(res.data.grants).toEqual([
        expect.objectContaining({
          terminal: 'hotel-terminal',
          role: 'front_desk',
          permissions: DEFAULT_HOTEL_TERMINAL_PERMISSIONS.front_desk,
        }),
      ]);
    });

    it('prefers user_terminal_access rows over legacy columns when they exist', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ role: 'buyer', allowedSystems: '["main","procurement"]' }),
      );
      prisma.userTerminalAccess.findMany.mockResolvedValue([
        {
          id: 'a-1',
          userId: 'u-1',
          tenantId: TENANT,
          terminal: 'accounting',
          role: 'accountant',
          permissions: null,
          approvalLimit: null,
          scopeIds: null,
          grantedBy: 'admin-1',
          grantedAt: new Date('2026-02-01T00:00:00Z'),
          revokedAt: null,
        },
      ]);
      const res = await service.findOne('u-1', TENANT);
      expect(res.data.grants).toEqual([
        expect.objectContaining({
          terminal: 'accounting',
          role: 'accountant',
          permissions: DEFAULT_ACCOUNTING_PERMISSIONS.accountant,
          grantedBy: 'admin-1',
        }),
      ]);
    });
  });

  // ── allowedSystems sync ───────────────────────────────────────────────────

  describe('replaceAccess → users.allowedSystems sync', () => {
    it('rewrites allowedSystems, primary role and legacy columns; revokes missing terminals', async () => {
      const user = makeUser({ role: 'waiter', allowedSystems: '["main","pos"]' });
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.userTerminalAccess.findMany
        .mockResolvedValueOnce([
          {
            id: 'row-pos',
            userId: 'u-1',
            tenantId: TENANT,
            terminal: 'pos',
            role: 'waiter',
            permissions: null,
            approvalLimit: null,
            scopeIds: null,
            grantedBy: null,
            grantedAt: new Date(),
            revokedAt: null,
          },
        ])
        .mockResolvedValue([]);

      await service.replaceAccess(
        'u-1',
        [
          { terminal: 'accounting', role: 'accountant' },
          { terminal: 'warehouse', role: 'receiver', scopeIds: ['wh-1'] },
        ],
        ACTOR,
      );

      expect(prisma.userTerminalAccess.create).toHaveBeenCalledTimes(2);
      expect(prisma.userTerminalAccess.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['row-pos'] } },
      });

      const update = prisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u-1' });
      // waiter → accountant + receiver: no manager-level grant, so the stale "main"
      // the account carried must be dropped (BUG 2026-11-09: main stuck forever).
      expect(JSON.parse(update.data.allowedSystems)).toEqual(['accounting', 'warehouse']);
      expect(update.data.role).toBe('accountant');
      expect(JSON.parse(update.data.warehousePermissions)).toEqual(
        DEFAULT_WAREHOUSE_PERMISSIONS.receiver,
      );
      expect(JSON.parse(update.data.warehouseIds)).toEqual(['wh-1']);

      const actions = auditLog.log.mock.calls.map((c) => c[0].action);
      expect(actions).toEqual(expect.arrayContaining(['user.access.grant', 'user.access.revoke']));
      expect(auditLog.log.mock.calls[0][0]).toMatchObject({
        resource: 'user',
        category: 'user-management',
        tenantId: TENANT,
        userId: 'admin-1',
      });
    });

    it('never adds "main" back when it was absent, and keeps admin-ish roles intact', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ id: 'u-2', role: 'manager', allowedSystems: '["pos"]' }),
      );
      await service.replaceAccess('u-2', [{ terminal: 'hr', role: 'hr_officer' }], ACTOR);

      const update = prisma.user.update.mock.calls[0][0];
      expect(JSON.parse(update.data.allowedSystems)).toEqual(['hr']);
      expect(update.data.role).toBeUndefined();
    });

    it('does NOT grant "main" for a manager-level terminal role (Owner Console = owner only)', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ id: 'u-3', role: 'waiter', allowedSystems: '["pos"]' }),
      );
      await service.replaceAccess(
        'u-3',
        [{ terminal: 'hotel-terminal', role: 'hotel_manager' }],
        ACTOR,
      );
      const update = prisma.user.update.mock.calls[0][0];
      expect(JSON.parse(update.data.allowedSystems)).toEqual(['hotel-terminal']);
    });

    it('rejects a role that does not belong to the terminal', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser());
      await expect(
        service.replaceAccess('u-1', [{ terminal: 'hr', role: 'waiter' }], ACTOR),
      ).rejects.toThrow(/waiter/);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ── Owner Console ("main") access — regression 2026-11-09 ─────────────────
  // A POS·waiter created from the users wizard could still sign in to the Owner
  // Console: "main" was only ever added, never recomputed, so any account that
  // once held a manager-level role kept it after being demoted.

  describe('Owner Console access (main) is recomputed on every write', () => {
    const lastAllowed = () =>
      JSON.parse(prisma.user.update.mock.calls.at(-1)![0].data.allowedSystems);

    it('a new POS·waiter account gets ["pos"] only', async () => {
      prisma.user.create.mockResolvedValue(
        makeUser({ id: 'new-1', role: 'waiter', allowedSystems: '[]' }),
      );
      prisma.user.findFirst
        .mockResolvedValueOnce(null) // email not taken
        .mockResolvedValue(makeUser({ id: 'new-1', role: 'waiter', allowedSystems: '["pos"]' }));
      await service.create(
        {
          email: 'waiter@hotel.test',
          firstName: 'W',
          lastName: 'T',
          grants: [{ terminal: 'pos', role: 'waiter' }],
          password: 'Password123!',
        } as any,
        ACTOR,
      );
      expect(lastAllowed()).toEqual(['pos']);
    });

    it('drops a stale "main" when a former manager is demoted to waiter', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ role: 'hotel_manager', allowedSystems: '["main","hotel-terminal","pos"]' }),
      );
      await service.replaceAccess('u-1', [{ terminal: 'pos', role: 'waiter' }], ACTOR);
      expect(lastAllowed()).toEqual(['pos']);
    });

    it.each([
      ['front_desk', 'hotel-terminal'],
      ['housekeeper', 'hotel-terminal'],
      ['chef', 'pos'],
      ['cashier', 'pos'],
      ['buyer', 'procurement'],
      ['inventory_clerk', 'warehouse'],
      ['accountant', 'accounting'],
      ['hr_officer', 'hr'],
    ])('frontline role %s on %s never gets "main"', async (role, terminal) => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'waiter', allowedSystems: '["main","pos"]' }));
      await service.replaceAccess('u-1', [{ terminal: terminal as any, role }], ACTOR);
      expect(lastAllowed()).not.toContain('main');
      expect(lastAllowed()).toEqual([terminal]);
    });

    it('a manager-level grant does not bring "main" back', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ role: 'waiter', allowedSystems: '["pos"]' }));
      await service.replaceAccess(
        'u-1',
        [
          { terminal: 'pos', role: 'waiter' },
          { terminal: 'hr', role: 'hr_manager' },
        ],
        ACTOR,
      );
      expect(lastAllowed()).toEqual(['pos', 'hr']);
    });

    it.each([
      ['hotel_manager', 'hotel-terminal'],
      ['procurement_manager', 'procurement'],
      ['warehouse_manager', 'warehouse'],
      ['chief_accountant', 'accounting'],
      ['hr_manager', 'hr'],
    ])('manager-level role %s on %s goes to its terminal only', async (role, terminal) => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ role, allowedSystems: `["main","${terminal}"]` }),
      );
      await service.replaceAccess('u-1', [{ terminal: terminal as any, role }], ACTOR);
      expect(lastAllowed()).toEqual([terminal]);
    });
  });

  describe('isTerminalAccountRole()', () => {
    const { isTerminalAccountRole } = jest.requireActual('./terminal-registry');
    it.each(['waiter', 'chef', 'front_desk', 'hotel_manager', 'hr_manager', 'buyer', 'procurement_manager', 'chief_accountant'])(
      '%s is a terminal role',
      (r) => expect(isTerminalAccountRole(r)).toBe(true),
    );
    it.each(['camp_manager', 'camp_staff', 'retail_manager', 'retail_cashier', 'crm_manager', 'crm_agent'])(
      '%s signs in at /login (main-session terminal) — not a terminal-only role',
      (r) => expect(isTerminalAccountRole(r)).toBe(false),
    );
    it.each(['tenant_admin', 'admin', 'platform_admin', 'manager', 'receptionist', 'staff', null])(
      '%s is not',
      (r) => expect(isTerminalAccountRole(r)).toBe(false),
    );
  });

  describe('main-session terminals (camp / retail / crm) — regression 2026-11-09', () => {
    const { computeAllowedSystems } = jest.requireActual('./terminal-registry');
    it.each([
      ['camp-terminal', 'camp_staff'],
      ['camp-terminal', 'camp_manager'],
      ['retail', 'retail_cashier'],
      ['crm', 'crm_agent'],
    ])('%s:%s keeps "main" — that terminal has no login of its own', (terminal, role) => {
      expect(computeAllowedSystems(role, [{ terminal, role }])).toEqual(['main', terminal]);
    });
  });

  describe('computeAllowedSystems()', () => {
    // imported lazily so the describe stays self-contained
    const { computeAllowedSystems } = jest.requireActual('./terminal-registry');

    it('owner / admin accounts always get main', () => {
      expect(computeAllowedSystems('tenant_admin', [])).toEqual(['main']);
      expect(computeAllowedSystems('admin', [{ terminal: 'pos', role: 'waiter' }])).toEqual([
        'main',
        'pos',
      ]);
    });

    it('manager-level terminal roles get terminals only', () => {
      expect(
        computeAllowedSystems('hotel_manager', [{ terminal: 'hotel-terminal', role: 'hotel_manager' }]),
      ).toEqual(['hotel-terminal']);
    });

    it('frontline account with no manager grant gets terminals only', () => {
      expect(computeAllowedSystems('waiter', [{ terminal: 'pos', role: 'waiter' }])).toEqual(['pos']);
    });

    it('does not trust the account role "waiter" to carry main from history', () => {
      expect(computeAllowedSystems('waiter', [])).toEqual([]);
    });

    it('de-duplicates terminals', () => {
      expect(
        computeAllowedSystems('chef', [
          { terminal: 'pos', role: 'chef' },
          { terminal: 'pos', role: 'chef' },
        ]),
      ).toEqual(['pos']);
    });
  });

  // ── seat limit ────────────────────────────────────────────────────────────

  describe('seat limit', () => {
    it('throws SEAT_LIMIT_REACHED when active users already fill plans.max_users', async () => {
      subscriptionsService.findByTenantId.mockResolvedValue({
        status: 'active',
        plans_subscriptions_plan_idToplans: { max_users: 3 },
      });
      prisma.user.count.mockResolvedValue(3);

      let caught: unknown;
      try {
        await service.create(
          {
            email: 'new@hotel.test',
            password: 'StrongPass123!',
            grants: [{ terminal: 'pos', role: 'waiter' }],
          },
          ACTOR,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as ForbiddenException).getResponse()).toMatchObject({
        code: 'SEAT_LIMIT_REACHED',
        details: { seatsUsed: 3, maxUsers: 3 },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates the user (with a generated password) when a seat is free', async () => {
      subscriptionsService.findByTenantId.mockResolvedValue({
        status: 'active',
        plans_subscriptions_plan_idToplans: { max_users: 3 },
      });
      prisma.user.count.mockResolvedValue(2);
      const created = makeUser({
        id: 'u-new',
        email: 'new@hotel.test',
        role: 'waiter',
        allowedSystems: '["main"]',
      });
      prisma.user.create.mockResolvedValue(created);
      // create() checks the email first (null = free), then loadOne() re-reads the row.
      prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValue(created);

      const res = await service.create(
        {
          email: 'New@Hotel.test',
          generatePassword: true,
          grants: [{ terminal: 'pos', role: 'waiter' }],
        },
        ACTOR,
      );

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@hotel.test',
            role: 'waiter',
            tenantId: TENANT,
          }),
        }),
      );
      expect(res.data.temporaryPassword).toHaveLength(12);
      expect(prisma.userTerminalAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ terminal: 'pos', role: 'waiter', userId: 'u-new' }),
        }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.create' }));
    });

    it('ignores the limit when the plan has no max_users', async () => {
      subscriptionsService.findByTenantId.mockResolvedValue({
        plans_subscriptions_plan_idToplans: { max_users: 0 },
      });
      prisma.user.count.mockResolvedValue(999);
      const created = makeUser({ id: 'u-new', role: 'waiter' });
      prisma.user.create.mockResolvedValue(created);
      prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValue(created);

      await expect(
        service.create(
          {
            email: 'x@hotel.test',
            password: 'StrongPass123!',
            grants: [{ terminal: 'pos', role: 'waiter' }],
          },
          ACTOR,
        ),
      ).resolves.toMatchObject({ success: true });
    });
  });

  // ── owner protection ──────────────────────────────────────────────────────

  describe('owner protection', () => {
    const owner = makeUser({ id: 'owner-1', role: 'tenant_admin', allowedSystems: '["main"]' });

    it('refuses to suspend / delete / edit access of a tenant_admin', async () => {
      prisma.user.findFirst.mockResolvedValue(owner);

      await expect(service.suspend('owner-1', 'left', ACTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.remove('owner-1', ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.replaceAccess('owner-1', [{ terminal: 'pos', role: 'waiter' }], ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userTerminalAccess.create).not.toHaveBeenCalled();
    });

    it('refuses to let callers suspend themselves', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ id: ACTOR.userId, role: 'manager' }));
      await expect(service.suspend(ACTOR.userId, 'oops', ACTOR)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('skips owners silently in bulk-access instead of failing the batch', async () => {
      prisma.user.findMany.mockResolvedValue([
        owner,
        makeUser({ id: 'u-9', role: 'waiter', allowedSystems: '["main","pos"]' }),
      ]);
      const res = await service.bulkAccess(
        { userIds: ['owner-1', 'u-9'], grant: { terminal: 'hr', role: 'hr_viewer' } },
        ACTOR,
      );
      expect(res.data.updated).toBe(1);
      const update = prisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u-9' });
      // waiter + hr_viewer are both frontline → the stale "main" is dropped
      expect(JSON.parse(update.data.allowedSystems)).toEqual(['pos', 'hr']);
    });

    it('suspend requires a reason and stores suspendedAt/By/Reason', async () => {
      const staff = makeUser({ id: 'u-5', role: 'waiter' });
      prisma.user.findFirst.mockResolvedValue(staff);
      await expect(service.suspend('u-5', '   ', ACTOR)).rejects.toThrow();

      await service.suspend('u-5', 'ลาออก', ACTOR);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-5' },
          data: expect.objectContaining({
            status: 'suspended',
            suspendedBy: 'admin-1',
            suspendedReason: 'ลาออก',
          }),
        }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.suspend' }),
      );
    });
  });
});
