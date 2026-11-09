import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStatus } from './entities/tenant.entity';

describe('TenantLifecycleService', () => {
  let service: TenantLifecycleService;
  let prismaFindUnique: jest.Mock;
  let prismaUpdate: jest.Mock;

  beforeEach(async () => {
    prismaFindUnique = jest.fn();
    prismaUpdate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantLifecycleService,
        {
          provide: PrismaService,
          useValue: {
            tenants: { findUnique: prismaFindUnique, update: prismaUpdate },
          },
        },
      ],
    }).compile();

    service = module.get(TenantLifecycleService);
  });

  it('allows trial -> active', async () => {
    prismaFindUnique.mockResolvedValue({ id: 't1', status: 'trial', name: 'X' });
    const r = await service.transition({
      tenantId: 't1',
      toStatus: TenantStatus.ACTIVE,
      reason: 'paid invoice',
    });
    expect(r.status).toBe(TenantStatus.ACTIVE);
    expect(prismaUpdate).toHaveBeenCalled();
  });

  it('allows active -> past_due', async () => {
    prismaFindUnique.mockResolvedValue({ id: 't1', status: 'active', name: 'X' });
    const r = await service.transition({
      tenantId: 't1',
      toStatus: TenantStatus.PAST_DUE,
      reason: 'invoice overdue',
    });
    expect(r.status).toBe(TenantStatus.PAST_DUE);
  });

  it('rejects invalid transition trial -> archived', async () => {
    prismaFindUnique.mockResolvedValue({ id: 't1', status: 'trial', name: 'X' });
    await expect(
      service.transition({
        tenantId: 't1',
        toStatus: TenantStatus.ARCHIVED,
        reason: 'unauthorized',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prismaUpdate).not.toHaveBeenCalled();
  });

  it('rejects archived -> anything (terminal)', async () => {
    prismaFindUnique.mockResolvedValue({ id: 't1', status: 'archived', name: 'X' });
    await expect(
      service.transition({
        tenantId: 't1',
        toStatus: TenantStatus.ACTIVE,
        reason: 'restore',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('is idempotent for same-state transition', async () => {
    prismaFindUnique.mockResolvedValue({ id: 't1', status: 'active', name: 'X' });
    const r = await service.transition({
      tenantId: 't1',
      toStatus: TenantStatus.ACTIVE,
      reason: 'noop',
    });
    expect(r.status).toBe(TenantStatus.ACTIVE);
    expect(prismaUpdate).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when tenant does not exist', async () => {
    prismaFindUnique.mockResolvedValue(null);
    await expect(
      service.transition({
        tenantId: 'missing',
        toStatus: TenantStatus.ACTIVE,
        reason: 'x',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('isOperational covers trial + active', () => {
    expect(service.isOperational(TenantStatus.TRIAL)).toBe(true);
    expect(service.isOperational(TenantStatus.ACTIVE)).toBe(true);
    expect(service.isOperational(TenantStatus.PAST_DUE)).toBe(false);
    expect(service.isOperational(TenantStatus.SUSPENDED)).toBe(false);
  });

  it('isReadOnly is true only for past_due', () => {
    expect(service.isReadOnly(TenantStatus.PAST_DUE)).toBe(true);
    expect(service.isReadOnly(TenantStatus.ACTIVE)).toBe(false);
  });

  it('canTransition matches the state matrix', () => {
    expect(service.canTransition(TenantStatus.PAST_DUE, TenantStatus.ACTIVE)).toBe(true);
    expect(service.canTransition(TenantStatus.PAST_DUE, TenantStatus.SUSPENDED)).toBe(true);
    expect(service.canTransition(TenantStatus.SUSPENDED, TenantStatus.ACTIVE)).toBe(true);
    expect(service.canTransition(TenantStatus.SUSPENDED, TenantStatus.PAST_DUE)).toBe(false);
  });
});
