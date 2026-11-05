import { CampSuppliersSeeder } from './camp-suppliers.seeder';

describe('CampSuppliersSeeder', () => {
  const make = () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', tenantId: 't1', userTenants: [] }),
      },
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'i1', sku: 'RT-BEER-CAN', sellingPrice: 60 },
          { id: 'i2', sku: 'GIFT-CUP', sellingPrice: null },
          { id: 'i3', sku: 'HK-TOWEL', sellingPrice: 200 },
        ]),
      },
      supplier: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => ({ id: `s-${data.code}`, ...data })),
        update: jest.fn(),
      },
      itemSupplier: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    return { prisma, seeder: new CampSuppliersSeeder(prisma) };
  };

  it('creates the tenant suppliers and links items by SKU prefix', async () => {
    const { prisma, seeder } = make();
    const r = await seeder.seed();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'premium.camp@email.com' } }),
    );
    expect(r?.created).toBeGreaterThanOrEqual(5);
    expect(prisma.supplier.create.mock.calls.every((c: any[]) => c[0].data.tenantId === 't1')).toBe(
      true,
    );
    // RT- → เครื่องดื่ม + แม็คโคร, GIFT- → แม็คโคร + ของที่ระลึก, HK- → ไม่ผูก
    expect(r?.linked).toBe(4);
    expect(prisma.itemSupplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: 'i1',
        supplierId: 's-CSUP-BEV',
        unitPrice: 36,
        isPreferred: true,
      }),
    });
  });

  it('is idempotent — existing suppliers/links are not duplicated', async () => {
    const { prisma, seeder } = make();
    prisma.supplier.findFirst.mockResolvedValue({ id: 's-x', isActive: true, deletedAt: null });
    prisma.itemSupplier.findFirst.mockResolvedValue({ id: 'link' });
    expect(await seeder.seed()).toEqual({ created: 0, linked: 0 });
    expect(prisma.supplier.create).not.toHaveBeenCalled();
  });

  it('skips when the user has no tenant', async () => {
    const { prisma, seeder } = make();
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await seeder.seed()).toBeNull();
  });
});
