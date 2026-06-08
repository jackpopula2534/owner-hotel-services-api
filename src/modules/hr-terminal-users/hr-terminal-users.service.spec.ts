// bcrypt has a native binding that doesn't always load in CI sandboxes — stub it.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HrTerminalUsersService } from './hr-terminal-users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_HR_PERMISSIONS } from './dto/create-hr-terminal-user.dto';

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

const TENANT = 'tenant-mountain';

describe('HrTerminalUsersService', () => {
  let service: HrTerminalUsersService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [HrTerminalUsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(HrTerminalUsersService);
  });

  describe('create', () => {
    it('creates an HR user with allowedSystems=[main,hr] and default role permissions', async () => {
      prisma.user.create.mockResolvedValueOnce({
        id: 'u1',
        email: 'hr@hotel.com',
        firstName: 'Som',
        lastName: 'Chai',
        role: 'hr_officer',
        status: 'active',
        employeeId: null,
        warehousePermissions: JSON.stringify(DEFAULT_HR_PERMISSIONS.hr_officer),
        lastLoginAt: null,
        createdAt: new Date(),
      });

      const res = await service.create(
        { email: 'hr@hotel.com', password: 'StrongPass123!', role: 'hr_officer' },
        TENANT,
      );

      const createArg = prisma.user.create.mock.calls[0][0].data;
      expect(createArg.tenantId).toBe(TENANT);
      expect(createArg.allowedSystems).toBe(JSON.stringify(['main', 'hr']));
      expect(JSON.parse(createArg.warehousePermissions)).toEqual(DEFAULT_HR_PERMISSIONS.hr_officer);
      expect(res.success).toBe(true);
      expect(res.data).toMatchObject({ email: 'hr@hotel.com', role: 'hr_officer' });
      expect(res.data.permissions).toEqual(DEFAULT_HR_PERMISSIONS.hr_officer);
    });

    it('honours explicit permissions override', async () => {
      prisma.user.create.mockResolvedValueOnce({
        id: 'u2', email: 'p@h.com', firstName: null, lastName: null,
        role: 'payroll_officer', status: 'active', employeeId: null,
        warehousePermissions: JSON.stringify(['payroll.view']), lastLoginAt: null, createdAt: new Date(),
      });
      await service.create(
        { email: 'p@h.com', password: 'StrongPass123!', role: 'payroll_officer', permissions: ['payroll.view'] },
        TENANT,
      );
      const createArg = prisma.user.create.mock.calls[0][0].data;
      expect(JSON.parse(createArg.warehousePermissions)).toEqual(['payroll.view']);
    });

    it('rejects duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'exists' });
      await expect(
        service.create({ email: 'dup@h.com', password: 'StrongPass123!', role: 'hr_manager' }, TENANT),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('queries only HR roles within the tenant', async () => {
      await service.findAll(TENANT);
      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT);
      expect(where.role.in).toEqual(
        expect.arrayContaining(['hr_manager', 'hr_officer', 'payroll_officer', 'recruiter', 'hr_viewer']),
      );
    });
  });

  describe('update', () => {
    it('re-asserts allowedSystems when role changes and hashes new password', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1', tenantId: TENANT });
      prisma.user.update.mockResolvedValueOnce({
        id: 'u1', email: 'a@h', firstName: null, lastName: null, role: 'hr_manager',
        status: 'active', employeeId: null, warehousePermissions: null, lastLoginAt: null, createdAt: new Date(),
      });
      await service.update('u1', TENANT, { role: 'hr_manager', password: 'NewPass123!' });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.role).toBe('hr_manager');
      expect(data.allowedSystems).toBe(JSON.stringify(['main', 'hr']));
      expect(data.password).toBe('hashed');
    });
  });

  describe('remove', () => {
    it('soft-deletes by setting status=inactive', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1', tenantId: TENANT });
      prisma.user.update.mockResolvedValueOnce({});
      const res = await service.remove('u1', TENANT);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { status: 'inactive' },
      });
      expect(res.success).toBe(true);
    });

    it('throws when user not found', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.remove('missing', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('stats', () => {
    it('aggregates counts by role and status', async () => {
      const now = Date.now();
      prisma.user.findMany.mockResolvedValueOnce([
        { role: 'hr_manager', status: 'active', lastLoginAt: new Date(now - 1000) },
        { role: 'hr_officer', status: 'active', lastLoginAt: null },
        { role: 'hr_officer', status: 'inactive', lastLoginAt: null },
      ]);
      const res = await service.stats(TENANT);
      expect(res.data.total).toBe(3);
      expect(res.data.active).toBe(2);
      expect(res.data.inactive).toBe(1);
      expect(res.data.loggedInToday).toBe(1);
      expect(res.data.byRole.hr_officer).toBe(2);
      expect(res.data.byRole.recruiter).toBe(0);
    });
  });
});
