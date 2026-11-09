import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';

/**
 * PATCH /tenants/:id — ownership + field whitelist.
 *
 * Regression: the endpoint allowed any `tenant_admin` to update ANY tenant id
 * and forwarded the camelCase DTO straight into prisma (which also meant
 * `status` / `trial_ends_at` were writable by the customer).
 */
describe('TenantsService.update', () => {
  let service: TenantsService;
  let userTenantFindFirst: jest.Mock;
  let tenantsUpdate: jest.Mock;

  beforeEach(async () => {
    userTenantFindFirst = jest.fn();
    tenantsUpdate = jest.fn().mockImplementation(async (args) => ({ id: args.where.id, ...args.data }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        {
          provide: PrismaService,
          useValue: {
            tenants: { update: tenantsUpdate },
            userTenant: { findFirst: userTenantFindFirst },
          },
        },
        {
          provide: TenantContextService,
          useValue: { runUnscoped: (fn: () => unknown) => fn() },
        },
      ],
    }).compile();

    service = module.get(TenantsService);
  });

  const owner = { userId: 'u-owner', role: 'tenant_admin', tenantId: 't-1' };

  it('forbids a tenant_admin who is only a member of the target tenant', async () => {
    userTenantFindFirst.mockResolvedValue({ role: 'member' });

    await expect(service.update('t-2', { name: 'Hijack' }, { ...owner, tenantId: 't-1' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(userTenantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-owner', tenantId: 't-2' } }),
    );
    expect(tenantsUpdate).not.toHaveBeenCalled();
  });

  it('forbids a tenant_admin with no membership row on a foreign tenant', async () => {
    userTenantFindFirst.mockResolvedValue(null);

    await expect(service.update('t-2', { name: 'Hijack' }, owner)).rejects.toThrow(ForbiddenException);
    expect(tenantsUpdate).not.toHaveBeenCalled();
  });

  it('forbids when the caller has no userId', async () => {
    await expect(service.update('t-1', { name: 'X' }, { role: 'tenant_admin' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an owner and maps camelCase → snake_case, dropping status/trialEndsAt', async () => {
    userTenantFindFirst.mockResolvedValue({ role: 'owner' });

    await service.update(
      't-1',
      {
        name: '  โรงแรมสุขใจ ',
        nameEn: 'Sukjai Hotel',
        propertyType: 'resort',
        roomCount: 42,
        taxId: '0105556789001',
        postalCode: '',
        status: 'active' as any,
        trialEndsAt: new Date('2099-01-01') as any,
        trialDays: 30,
      },
      owner,
    );

    expect(tenantsUpdate).toHaveBeenCalledTimes(1);
    const { data } = tenantsUpdate.mock.calls[0][0];
    expect(data).toEqual({
      name: 'โรงแรมสุขใจ',
      name_en: 'Sukjai Hotel',
      property_type: 'resort',
      room_count: 42,
      tax_id: '0105556789001',
      postal_code: null,
    });
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('trial_ends_at');
    expect(data).not.toHaveProperty('nameEn');
  });

  it('allows an admin membership row', async () => {
    userTenantFindFirst.mockResolvedValue({ role: 'admin' });
    await expect(service.update('t-1', { phone: '02-000-0000' }, owner)).resolves.toBeDefined();
    expect(tenantsUpdate.mock.calls[0][0].data).toEqual({ phone: '02-000-0000' });
  });

  it('legacy fallback: tenant_admin without a junction row may edit their own JWT tenant', async () => {
    userTenantFindFirst.mockResolvedValue(null);
    await expect(service.update('t-1', { name: 'Mine' }, owner)).resolves.toBeDefined();
  });

  it('platform_admin bypasses membership and may set status', async () => {
    await service.update('t-9', { name: 'Any', status: 'suspended' as any }, { userId: 'pa', role: 'platform_admin' });
    expect(userTenantFindFirst).not.toHaveBeenCalled();
    expect(tenantsUpdate.mock.calls[0][0].data).toEqual({ name: 'Any', status: 'suspended' });
  });

  it('rejects an empty name and a payload with no editable fields', async () => {
    userTenantFindFirst.mockResolvedValue({ role: 'owner' });
    await expect(service.update('t-1', { name: '   ' }, owner)).rejects.toThrow(BadRequestException);
    await expect(service.update('t-1', { status: 'active' as any }, owner)).rejects.toThrow(BadRequestException);
    expect(tenantsUpdate).not.toHaveBeenCalled();
  });
});
