import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobPostingService } from './job-posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    hrJobPosting: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    hrManpowerRequest: { findFirst: jest.fn() },
    hrCandidate: { create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  };
}

describe('JobPostingService', () => {
  let service: JobPostingService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobPostingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(JobPostingService);
  });

  describe('isWindowOpen', () => {
    const now = new Date('2026-06-11T12:00:00Z');

    it('open when published and within window', () => {
      const posting = { status: 'published', openAt: new Date('2026-06-10'), closeAt: new Date('2026-06-20') };
      expect(service.isWindowOpen(posting, now)).toBe(true);
    });

    it('open when published with no bounds', () => {
      expect(service.isWindowOpen({ status: 'published', openAt: null, closeAt: null }, now)).toBe(true);
    });

    it('closed before openAt', () => {
      const posting = { status: 'published', openAt: new Date('2026-06-12'), closeAt: null };
      expect(service.isWindowOpen(posting, now)).toBe(false);
    });

    it('closed after closeAt', () => {
      const posting = { status: 'published', openAt: null, closeAt: new Date('2026-06-10') };
      expect(service.isWindowOpen(posting, now)).toBe(false);
    });

    it('closed when not published (draft / closed)', () => {
      expect(service.isWindowOpen({ status: 'draft', openAt: null, closeAt: null }, now)).toBe(false);
      expect(service.isWindowOpen({ status: 'closed', openAt: null, closeAt: null }, now)).toBe(false);
    });
  });

  describe('upsert gating', () => {
    it('rejects when manpower request is not in a postable status', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'mpr1', status: 'budget_pending' });
      await expect(
        service.upsert('mpr1', { title: 'งาน' }, 'tenant1', 'user1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a posting with a public token when recruiting', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'mpr1', status: 'recruiting', employmentType: 'FULLTIME', propertyId: 'p1' });
      prisma.hrJobPosting.findUnique.mockResolvedValue(null);
      prisma.hrJobPosting.create.mockImplementation(({ data }: any) => ({ id: 'jp1', ...data }));

      const result = await service.upsert('mpr1', { title: 'พนักงานต้อนรับ' }, 'tenant1', 'user1');
      expect(result.publicToken).toEqual(expect.any(String));
      expect(result.publicToken.length).toBeGreaterThan(16);
      expect(result.status).toBe('draft');
    });
  });

  describe('submitApplication', () => {
    it('rejects without PDPA consent', async () => {
      await expect(
        service.submitApplication('tok', { firstName: 'A', lastName: 'B', consentGiven: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the posting window is closed', async () => {
      prisma.hrJobPosting.findUnique.mockResolvedValue({
        id: 'jp1', status: 'closed', openAt: null, closeAt: null,
      });
      await expect(
        service.submitApplication('tok', { firstName: 'A', lastName: 'B', consentGiven: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown / draft token', async () => {
      prisma.hrJobPosting.findUnique.mockResolvedValue(null);
      await expect(
        service.submitApplication('tok', { firstName: 'A', lastName: 'B', consentGiven: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a public_form candidate when open', async () => {
      prisma.hrJobPosting.findUnique.mockResolvedValue({
        id: 'jp1', status: 'published', openAt: null, closeAt: null,
        tenantId: 'tenant1', manpowerRequestId: 'mpr1',
      });
      prisma.hrCandidate.create.mockImplementation(({ data }: any) => ({ id: 'c1', ...data }));

      const result = await service.submitApplication('tok', {
        firstName: 'สมหญิง',
        lastName: 'ขยัน',
        email: 'somying@example.com',
        nationalId: '1234567890123',
        educations: [{ level: 'ปริญญาตรี', institution: 'ม.ดัง' }],
        consentGiven: true,
      });

      expect(result.status).toBe('applied');
      const createArg = prisma.hrCandidate.create.mock.calls[0][0].data;
      expect(createArg.source).toBe('public_form');
      expect(createArg.jobPostingId).toBe('jp1');
      expect(createArg.consentGiven).toBe(true);
      expect(createArg.applicationData.nationalId).toBe('1234567890123');
      expect(createArg.applicationData.educations).toHaveLength(1);
    });
  });
});
