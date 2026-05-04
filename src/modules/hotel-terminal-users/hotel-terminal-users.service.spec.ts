// bcrypt has a native binding that doesn't always load in CI sandboxes — the
// service only uses it for password hashing in code paths these tests don't
// exercise, so we stub it before requiring the service module.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HotelTerminalUsersService } from './hotel-terminal-users.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tests for the HR → Hotel Terminal Users sync flow.
 *
 * Specifically guards the bug where seed data is present but the modal
 * "Sync จากระบบ HR" reports "ยังไม่มีพนักงานในระบบ HR". The fix layered three
 * tenant-resolution paths and a diagnostic envelope; these specs assert each.
 */

function createMockPrisma() {
  return {
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userTenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  };
}

describe('HotelTerminalUsersService.listImportableEmployees', () => {
  let service: HotelTerminalUsersService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [HotelTerminalUsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get<HotelTerminalUsersService>(HotelTerminalUsersService);
  });

  it('returns importable employees from the primary tenant when seeded', async () => {
    prisma.employee.count.mockResolvedValueOnce(1); // primary count
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        firstName: 'วิชัย',
        lastName: 'มณีรัตน์',
        email: 'wichai@mountain.hotel',
        employeeCode: 'PM-0001',
        department: 'ฝ่ายบริหาร',
        position: 'GM',
        propertyId: 'prop-1',
        status: 'ACTIVE',
      },
    ]);

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-mountain' }),
        skip: 0,
        take: 20,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: 'e1',
      firstName: 'วิชัย',
      alreadyLinked: false,
    });
    expect(res.meta).toMatchObject({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    // Diagnostic should NOT be attached on success path.
    expect((res.meta as any).diagnostic).toBeUndefined();
  });

  it('honours page + limit query params', async () => {
    prisma.employee.count.mockResolvedValueOnce(105); // total
    prisma.employee.findMany.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        id: `e${i + 21}`,
        firstName: `F${i}`,
        lastName: `L${i}`,
        email: `e${i + 21}@h`,
        employeeCode: `C${i + 21}`,
        department: 'D',
        position: 'P',
        propertyId: 'p1',
        status: 'ACTIVE',
      })),
    );

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
      page: 2,
      limit: 20,
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
    expect(res.data).toHaveLength(20);
    expect(res.meta).toMatchObject({
      page: 2,
      limit: 20,
      total: 105,
      totalPages: 6,
    });
  });

  it('passes search and department filters into the WHERE clause', async () => {
    prisma.employee.count.mockResolvedValueOnce(2);
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        firstName: 'มาลี',
        lastName: 'ตรวจละเอียด',
        email: 'malee@h',
        employeeCode: 'PM-0004',
        department: 'ฝ่ายต้อนรับ',
        position: 'Front Desk Agent',
        propertyId: 'p1',
        status: 'ACTIVE',
      },
    ]);

    await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
      search: 'malee',
      department: 'ฝ่ายต้อนรับ',
    });

    const callArg = prisma.employee.count.mock.calls[0][0];
    expect(callArg.where.tenantId).toBe('tenant-mountain');
    expect(callArg.where.department).toBe('ฝ่ายต้อนรับ');
    expect(Array.isArray(callArg.where.OR)).toBe(true);
    expect(callArg.where.OR.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to a UserTenant-linked tenant when the primary tenant is empty', async () => {
    // Primary count → 0; fallback count → 54.
    prisma.employee.count.mockResolvedValueOnce(0).mockResolvedValueOnce(54);
    // UserTenant memberships → caller is also linked to "tenant-other".
    prisma.userTenant.findMany.mockResolvedValueOnce([{ tenantId: 'tenant-other' }]);
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ tenantId: 'tenant-other', cnt: 54 }]);
    // findMany on the resolved tenant returns one row from the page.
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e2',
        firstName: 'มาลี',
        lastName: 'รักษ์ดี',
        email: 'malee@mountain.hotel',
        employeeCode: 'PM-0004',
        department: 'ฝ่ายต้อนรับ',
        position: 'Front Desk Agent',
        propertyId: 'prop-1',
        status: 'Active',
      },
    ]);

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
    });

    expect(prisma.userTenant.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { tenantId: true },
    });
    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-other' }),
      }),
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: 'e2', alreadyLinked: false });
    expect(res.meta).toMatchObject({ total: 54, page: 1, limit: 20 });
  });

  it('filters out terminated/resigned/inactive employees case-insensitively', async () => {
    prisma.employee.count.mockResolvedValueOnce(3);
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e-active',
        firstName: 'A',
        lastName: 'A',
        email: 'a@h',
        employeeCode: 'A',
        department: 'D',
        position: 'P',
        propertyId: 'prop-1',
        status: 'Active',
      },
      {
        id: 'e-resigned',
        firstName: 'B',
        lastName: 'B',
        email: 'b@h',
        employeeCode: 'B',
        department: 'D',
        position: 'P',
        propertyId: 'prop-1',
        status: 'Resigned',
      },
      {
        id: 'e-inactive',
        firstName: 'C',
        lastName: 'C',
        email: 'c@h',
        employeeCode: 'C',
        department: 'D',
        position: 'P',
        propertyId: 'prop-1',
        status: 'INACTIVE',
      },
    ]);

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
    });

    expect(res.data.map((d) => d.id)).toEqual(['e-active']);
  });

  it('marks employees whose email already exists as a user as alreadyLinked', async () => {
    prisma.employee.count.mockResolvedValueOnce(1);
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        firstName: 'X',
        lastName: 'Y',
        email: 'paisal.chef@mountain.hotel',
        employeeCode: 'C',
        department: 'D',
        position: 'P',
        propertyId: 'prop-1',
        status: 'ACTIVE',
      },
    ]);
    prisma.user.findMany.mockResolvedValueOnce([
      { email: 'paisal.chef@mountain.hotel', role: 'waiter' },
    ]);

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
    });

    expect(res.data[0].alreadyLinked).toBe(true);
  });

  it('returns an empty list with a diagnostic envelope when nothing matches', async () => {
    // Primary count: empty. UserTenant fallback: empty too.
    prisma.employee.count
      .mockResolvedValueOnce(0) // primary
      .mockResolvedValueOnce(54); // diagnostic global probe
    prisma.userTenant.findMany.mockResolvedValueOnce([]);
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ tenantId: 'tenant-other', cnt: 54 }]);

    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: 'tenant-mountain',
    });

    expect(res.data).toEqual([]);
    expect(res.meta.diagnostic).toMatchObject({
      reason: 'no_employees_for_tenant',
      primaryTenantId: 'tenant-mountain',
      globalEmployeeCount: 54,
      tenantsWithEmployees: [{ tenantId: 'tenant-other', count: 54 }],
    });
  });

  it('reports no_tenant_in_token when caller has no tenantId', async () => {
    const res = await service.listImportableEmployees({
      userId: 'user-1',
      tenantId: '',
    });

    expect(res.data).toEqual([]);
    expect(res.meta.diagnostic?.reason).toBe('no_tenant_in_token');
    // Should not even hit the database.
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(prisma.employee.count).not.toHaveBeenCalled();
  });

  it('still accepts a bare tenantId string for backwards compatibility', async () => {
    prisma.employee.count.mockResolvedValueOnce(1);
    prisma.employee.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        firstName: 'A',
        lastName: 'A',
        email: 'a@h',
        employeeCode: 'A',
        department: 'D',
        position: 'P',
        propertyId: 'prop-1',
        status: 'ACTIVE',
      },
    ]);

    const res = await service.listImportableEmployees('tenant-mountain');

    expect(res.data).toHaveLength(1);
    expect(res.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  describe('listImportableEmployeeDepartments', () => {
    it('returns distinct, non-empty department names for the resolved tenant', async () => {
      prisma.employee.count.mockResolvedValueOnce(3);
      prisma.employee.findMany.mockResolvedValueOnce([
        { department: 'ฝ่ายบริหาร' },
        { department: 'ฝ่ายต้อนรับ' },
        { department: '' }, // ignored
        { department: 'ฝ่ายแม่บ้าน' },
      ]);

      const res = await service.listImportableEmployeeDepartments({
        userId: 'user-1',
        tenantId: 'tenant-mountain',
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(['ฝ่ายบริหาร', 'ฝ่ายต้อนรับ', 'ฝ่ายแม่บ้าน']);
    });
  });
});
