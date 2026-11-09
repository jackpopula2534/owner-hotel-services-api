import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrOffboardingService } from './hr-offboarding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn(), update: jest.fn() },
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    staff: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    hrOffboarding: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('HrOffboardingService', () => {
  let service: HrOffboardingService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrOffboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(HrOffboardingService);
  });

  it('seeds default clearance checklist on create', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrOffboarding.findFirst.mockResolvedValue(null);
    prisma.hrOffboarding.create.mockImplementation(({ data }: any) => ({ id: 'o1', ...data }));
    const res = await service.create({ employeeId: 'e1', type: 'resignation' }, 't1', 'u1');
    expect(res.clearanceItems.length).toBe(HrOffboardingService.DEFAULT_CLEARANCE.length);
    expect(res.status).toBe('clearing');
  });

  it('blocks a second active offboarding', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrOffboarding.findFirst.mockResolvedValue({ id: 'existing', status: 'clearing' });
    await expect(
      service.create({ employeeId: 'e1', type: 'resignation' }, 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to complete when clearance incomplete', async () => {
    prisma.hrOffboarding.findFirst.mockResolvedValue({
      id: 'o1', status: 'clearing', employeeId: 'e1',
      clearanceItems: [{ label: 'a', done: true }, { label: 'b', done: false }],
    });
    await expect(service.complete('o1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes user, unlinks staff and sets TERMINATED on complete (termination)', async () => {
    prisma.hrOffboarding.findFirst.mockResolvedValue({
      id: 'o1', status: 'clearing', employeeId: 'e1', type: 'termination',
      clearanceItems: [{ label: 'a', done: true }],
    });
    prisma.employee.findFirst.mockResolvedValue({ email: 'somchai@hotel.test', employeeCode: 'EMP-001' });
    prisma.hrOffboarding.update.mockImplementation(({ data }: any) => ({ id: 'o1', ...data }));
    await service.complete('o1', 't1', 'u1');

    // users.employeeId เก็บ "รหัส" ไม่ใช่ id ของ employees — ค้นด้วย employeeId: 'e1'
    // ตรง ๆ จะไม่เจอบัญชีใครเลย ต้องไล่จากตัวพนักงานจริงทั้งสามทางที่ระบบใช้ผูกบัญชี
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't1',
        OR: [
          { metadata: { contains: '"hrEmployeeId":"e1"' } },
          { employeeId: 'EMP-001' },
          { email: 'somchai@hotel.test' },
        ],
      },
      data: { status: 'inactive' },
    });
    // ทะเบียนพนักงานปฏิบัติการผูกด้วย FK จริง จับคู่ด้วย id ได้ตามเดิม
    expect(prisma.staff.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', employeeId: 'e1' },
      data: { status: 'inactive' },
    });
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'TERMINATED' },
    });
  });

  it('still revokes by metadata link when the employee has no code or email on file', async () => {
    prisma.hrOffboarding.findFirst.mockResolvedValue({
      id: 'o1', status: 'clearing', employeeId: 'e1', type: 'resignation',
      clearanceItems: [{ label: 'a', done: true }],
    });
    prisma.employee.findFirst.mockResolvedValue({ email: '', employeeCode: null });
    prisma.hrOffboarding.update.mockImplementation(({ data }: any) => ({ id: 'o1', ...data }));
    await service.complete('o1', 't1', 'u1');

    // ค่าว่างต้องไม่กลายเป็นเงื่อนไขกว้าง ๆ ที่ไปปิดบัญชีคนอื่นทั้ง tenant
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', OR: [{ metadata: { contains: '"hrEmployeeId":"e1"' } }] },
      data: { status: 'inactive' },
    });
  });

  it('throws when offboarding not found', async () => {
    prisma.hrOffboarding.findFirst.mockResolvedValue(null);
    await expect(service.findOne('x', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
