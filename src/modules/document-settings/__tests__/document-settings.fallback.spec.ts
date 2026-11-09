import { DocumentSettingsService } from '../document-settings.service';
import { DocumentSettingsController } from '../document-settings.controller';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { StorageService } from '@/common/storage/storage.service';

describe('DocumentSettings company fallback', () => {
  const tenantRow = {
    name: 'Mountain View Resort',
    name_en: null,
    tax_id: '0105556789001',
    address: '456 ถนนห้วยแก้ว',
    district: 'สุเทพ',
    province: 'เชียงใหม่',
    postal_code: '50200',
    phone: '053-000000',
    email: '',
    website: null,
  };

  function makeService(row: unknown) {
    const prisma = {
      tenants: { findUnique: jest.fn().mockResolvedValue(row) },
      documentSettings: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ds1', companyName: null, taxId: null }),
      },
    } as unknown as PrismaService;
    return { service: new DocumentSettingsService(prisma), prisma };
  }

  it('maps the tenant profile and joins the address parts', async () => {
    const { service, prisma } = makeService(tenantRow);
    const fb = await service.getCompanyFallback('t1');
    expect((prisma as any).tenants.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    );
    expect(fb).toEqual({
      companyName: 'Mountain View Resort',
      companyNameEn: null,
      taxId: '0105556789001',
      address: '456 ถนนห้วยแก้ว สุเทพ เชียงใหม่ 50200',
      phone: '053-000000',
      email: null,
      website: null,
    });
  });

  it('returns null when the tenant row is missing', async () => {
    const { service } = makeService(null);
    await expect(service.getCompanyFallback('t1')).resolves.toBeNull();
  });

  it('GET attaches companyFallback next to the stored settings', async () => {
    const { service } = makeService(tenantRow);
    const controller = new DocumentSettingsController(service, {} as StorageService);
    const res = await controller.get('p1', { tenantId: 't1', userId: 'u1' });
    expect(res.data).toMatchObject({ id: 'ds1', companyName: null });
    expect((res.data.companyFallback as { taxId: string }).taxId).toBe('0105556789001');
  });
});

describe('DocumentSettingsController role guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ROLES_KEY } = require('@/common/decorators/roles.decorator');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RolesGuard } = require('@/common/guards/roles.guard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GUARDS_METADATA } = require('@nestjs/common/constants');
  const proto = DocumentSettingsController.prototype as unknown as Record<string, () => unknown>;
  const rolesOf = (m: string): string[] | undefined => Reflect.getMetadata(ROLES_KEY, proto[m]);

  it('runs RolesGuard on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DocumentSettingsController)).toContain(RolesGuard);
  });

  it.each(['update', 'uploadLogo', 'removeLogo'])('%s is limited to managers', (m) => {
    expect(rolesOf(m)).toEqual(expect.arrayContaining(['procurement_manager', 'owner', 'accounting_manager']));
    expect(rolesOf(m)).not.toContain('buyer');
  });

  it('reading stays open to every signed-in role (POS receipts need it)', () => {
    expect(rolesOf('get')).toBeUndefined();
  });
});
