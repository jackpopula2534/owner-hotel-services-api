import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CandidateService, candidateDiff, mergeApplicationData } from './candidate.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UpdateCandidateDto } from './dto/recruitment.dto';

describe('mergeApplicationData', () => {
  it('keeps untouched keys, clears empty strings and replaces arrays without blank rows', () => {
    const merged = mergeApplicationData(
      { nickname: 'ฝน', nationalId: '1111111111111', educations: [{ level: 'ปวช.' }] },
      {
        nationalId: '',
        address: ' 12/3 ภูเก็ต ',
        educations: [
          { level: 'ปวส.', institution: 'วิทยาลัย' },
          { level: '', institution: '' },
        ],
      },
    );
    expect(merged).toEqual({
      nickname: 'ฝน',
      nationalId: null,
      address: '12/3 ภูเก็ต',
      educations: [{ level: 'ปวส.', institution: 'วิทยาลัย' }],
    });
  });

  it('starts from an empty object when the candidate had no application data', () => {
    expect(mergeApplicationData(null, { gender: 'female' })).toEqual({ gender: 'female' });
  });
});

describe('candidateDiff', () => {
  it('reports only changed fields and flattens application data', () => {
    const d = candidateDiff(
      { phone: '080', email: null, applicationData: { gender: 'male', address: 'a' } },
      { phone: '080', email: 'x@y.z', applicationData: { gender: 'female', address: 'a' } },
    );
    expect(d.fields).toEqual(['email', 'applicationData.gender']);
    expect(d.oldValues).toEqual({ email: null, 'applicationData.gender': 'male' });
  });
});

describe('UpdateCandidateDto validation', () => {
  it('accepts nested application data', async () => {
    const dto = plainToInstance(UpdateCandidateDto, {
      email: 'a@b.co',
      applicationData: {
        dateOfBirth: '1990-01-31',
        gender: 'male',
        educations: [{ level: 'ป.ตรี' }],
      },
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid gender and a bad email', async () => {
    const dto = plainToInstance(UpdateCandidateDto, {
      email: 'not-an-email',
      applicationData: { gender: 'x' },
    });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property).sort()).toEqual(['applicationData', 'email']);
  });
});

describe('CandidateService.update', () => {
  let service: CandidateService;
  const prisma = {
    hrCandidate: { findFirst: jest.fn(), update: jest.fn() },
    auditLog: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(CandidateService);
    prisma.hrCandidate.update.mockImplementation(({ data }) => ({ id: 'c1', ...data }));
  });

  it('fills a missing email and merges application data', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'offer_made',
      email: null,
      applicationData: { nickname: 'ฝน' },
    });
    await service.update(
      'c1',
      {
        email: 'new@hotel.test',
        applicationData: { nationalId: '1234567890123' },
      } as UpdateCandidateDto,
      't1',
      'u1',
    );
    const data = prisma.hrCandidate.update.mock.calls[0][0].data;
    expect(data.email).toBe('new@hotel.test');
    expect(data.applicationData).toEqual({ nickname: 'ฝน', nationalId: '1234567890123' });
    expect(data).not.toHaveProperty('firstName');
    await new Promise((r) => setImmediate(r));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'c1',
        userId: 'u1',
        oldValues: { email: null, 'applicationData.nationalId': null },
        newValues: { email: 'new@hotel.test', 'applicationData.nationalId': '1234567890123' },
      }),
    );
  });

  it('skips the write and the log when nothing changed', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'applied',
      email: 'a@b.co',
      expectedSalary: { toNumber: () => 16000, toString: () => '16000' },
      applicationData: { nickname: 'ฝน' },
    });
    await service.update(
      'c1',
      {
        email: 'a@b.co',
        expectedSalary: 16000,
        applicationData: { nickname: 'ฝน' },
      } as UpdateCandidateDto,
      't1',
      'u1',
    );
    expect(prisma.hrCandidate.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('syncs resumeUrl from the attachments set', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'applied',
      attachments: [],
      resumeUrl: null,
    });
    await service.update(
      'c1',
      { attachments: [{ kind: 'resume', url: '/u/cv.pdf', name: 'cv.pdf' }] } as UpdateCandidateDto,
      't1',
      'u1',
    );
    expect(prisma.hrCandidate.update.mock.calls[0][0].data).toMatchObject({
      resumeUrl: '/u/cv.pdf',
      attachments: [{ kind: 'resume', url: '/u/cv.pdf', name: 'cv.pdf' }],
    });
  });

  it('returns history with field changes and editor names', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'applied',
      interviews: [{ id: 'iv1' }],
    });
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'l2',
        resource: 'interview',
        action: 'UPDATE',
        description: 'เลื่อนนัดสัมภาษณ์ รอบ 1: ผู้สมัครติดธุระ',
        createdAt: new Date('2026-11-03T04:00:00Z'),
        userId: 'u1',
        oldValues: { scheduledAt: '2026-11-04T02:30:00.000Z' },
        newValues: { scheduledAt: '2026-11-05T02:30:00.000Z', reason: 'ผู้สมัครติดธุระ' },
      },
      {
        id: 'l1',
        action: 'UPDATE',
        description: 'แก้ไขข้อมูลผู้สมัคร: email',
        createdAt: new Date('2026-11-03T03:00:00Z'),
        userId: 'u1',
        oldValues: { email: null },
        newValues: { email: 'a@b.co' },
      },
      {
        id: 'l0',
        action: 'CREATE',
        description: 'added',
        createdAt: new Date('2026-10-30T08:51:00Z'),
        userId: null,
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'Premium', lastName: 'Tester', email: 'p@t.co' },
    ]);

    const h = await service.getHistory('c1', 't1');
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      OR: [
        { resource: 'candidate', resourceId: 'c1' },
        { resource: 'interview', resourceId: { in: ['iv1'] } },
      ],
    });
    expect(h[0]).toMatchObject({
      kind: 'interview',
      reason: 'ผู้สมัครติดธุระ',
      changes: [
        { field: 'scheduledAt', from: '2026-11-04T02:30:00.000Z', to: '2026-11-05T02:30:00.000Z' },
      ],
    });
    expect(h[1]).toMatchObject({
      kind: 'candidate',
      reason: null,
      user: { id: 'u1', name: 'Premium Tester' },
      changes: [{ field: 'email', from: null, to: 'a@b.co' }],
    });
    expect(h[2]).toMatchObject({ user: null, changes: [] });
  });

  it('withdrawing requires a reason and logs it', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({ id: 'c1', status: 'screening' });
    await expect(
      service.update('c1', { status: 'withdrawn' } as UpdateCandidateDto, 't1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.hrCandidate.update.mockResolvedValue({ id: 'c1' });
    await service.update(
      'c1',
      { status: 'withdrawn', statusReason: 'ได้งานที่อื่นแล้ว' } as UpdateCandidateDto,
      't1',
      'u1',
    );
    expect(prisma.hrCandidate.update.mock.calls[0][0].data).toMatchObject({
      status: 'withdrawn',
      statusReason: 'ได้งานที่อื่นแล้ว',
    });
  });

  it('refuses to edit a hired candidate', async () => {
    prisma.hrCandidate.findFirst.mockResolvedValue({ id: 'c1', status: 'hired' });
    await expect(
      service.update('c1', { phone: '1' } as UpdateCandidateDto, 't1', 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
