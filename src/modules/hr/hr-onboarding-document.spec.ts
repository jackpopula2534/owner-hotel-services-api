import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HrOnboardingService } from './hr-onboarding.service';
import { HrEmployeeDocumentService } from './hr-employee-document.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';

const audit = { log: jest.fn().mockResolvedValue(undefined) };

describe('HrOnboardingService', () => {
  let service: HrOnboardingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      // ไม่มีประเภทเอกสารที่ตั้งค่าไว้ → ใช้ LEGACY_DOCUMENT_TEMPLATE
      hrDocumentType: { findMany: jest.fn().mockResolvedValue([]) },
      hrOnboardingTask: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 7 }),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrOnboardingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(HrOnboardingService);
  });

  it('seeds the default template when no custom tasks given', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrOnboardingTask.findMany
      // 1st call: งานที่มีอยู่แล้ว (ยังไม่มี) → สร้างครบทุกข้อ
      .mockResolvedValueOnce([])
      // 2nd call: findByEmployee หลังสร้าง
      .mockResolvedValue(
        HrOnboardingService.DEFAULT_TEMPLATE.map((t, i) => ({
          id: String(i),
          ...t,
          isComplete: false,
        })),
      );
    const res = await service.seed({ employeeId: 'e1' }, 't1', 'u1');
    expect(prisma.hrOnboardingTask.createMany).toHaveBeenCalled();
    const created = prisma.hrOnboardingTask.createMany.mock.calls[0][0].data;
    expect(created.length).toBe(HrOnboardingService.DEFAULT_TEMPLATE.length);
    expect(res.total).toBe(HrOnboardingService.DEFAULT_TEMPLATE.length);
  });

  it('computes progress fraction', async () => {
    prisma.hrOnboardingTask.findMany.mockResolvedValue([
      { id: '1', isComplete: true },
      { id: '2', isComplete: false },
      { id: '3', isComplete: true },
      { id: '4', isComplete: false },
    ]);
    const res = await service.findByEmployee('e1', 't1');
    expect(res.completed).toBe(2);
    expect(res.progress).toBeCloseTo(0.5);
  });

  it('stamps completedAt/By when marking complete', async () => {
    prisma.hrOnboardingTask.findFirst.mockResolvedValue({ id: 'task1', employeeId: 'e1' });
    prisma.hrOnboardingTask.update.mockImplementation(({ data }: any) => ({
      id: 'task1',
      ...data,
    }));
    await service.updateTask('task1', { isComplete: true }, 't1', 'u1');
    const data = prisma.hrOnboardingTask.update.mock.calls[0][0].data;
    expect(data.isComplete).toBe(true);
    expect(data.completedBy).toBe('u1');
    expect(data.completedAt).toBeInstanceOf(Date);
  });
});

describe('HrEmployeeDocumentService', () => {
  let service: HrEmployeeDocumentService;
  let prisma: any;
  const lifecycle = {
    syncRequirementForUploadedDocument: jest.fn().mockResolvedValue(undefined),
    revertRequirementForRemovedDocument: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      // tenant ยังไม่ตั้งค่าประเภทเอกสาร → รับ type อะไรก็ได้
      hrDocumentType: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      hrEmployeeDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrEmployeeDocumentService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
        { provide: HrLifecycleAssignmentService, useValue: lifecycle },
      ],
    }).compile();
    service = module.get(HrEmployeeDocumentService);
  });

  it('creates a document with parsed dates + audit', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrEmployeeDocument.create.mockImplementation(({ data }: any) => ({ id: 'd1', ...data }));
    const res = await service.create(
      {
        employeeId: 'e1',
        type: 'contract',
        name: 'สัญญา',
        fileUrl: 'http://x',
        expiresAt: '2027-01-01',
      },
      't1',
      'u1',
    );
    expect(res.expiresAt).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalled();
    expect(lifecycle.syncRequirementForUploadedDocument).toHaveBeenCalledWith('d1', 't1');
  });

  it('soft-deletes via deletedAt', async () => {
    prisma.hrEmployeeDocument.findFirst.mockResolvedValue({ id: 'd1' });
    prisma.hrEmployeeDocument.update.mockImplementation(({ data }: any) => ({ id: 'd1', ...data }));
    const res = await service.remove('d1', 't1', 'u1');
    expect(res.deletedAt).toBeInstanceOf(Date);
  });

  it('throws on missing document', async () => {
    prisma.hrEmployeeDocument.findFirst.mockResolvedValue(null);
    await expect(service.findOne('x', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
