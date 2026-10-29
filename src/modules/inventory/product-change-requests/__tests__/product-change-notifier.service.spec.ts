import { ProductChangeNotifierService } from '../product-change-notifier.service';

/**
 * Regression: submitting a product request failed with
 * "[TenantScope] findUnique() is not allowed on tenant-scoped model User"
 * because nameOf() used findUnique. It must filter by tenant with findFirst.
 */
describe('ProductChangeNotifierService.nameOf', () => {
  const prisma = { user: { findFirst: jest.fn(), findUnique: jest.fn() } };
  const service = new ProductChangeNotifierService(
    prisma as never,
    { create: jest.fn() } as never,
    { log: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('looks the user up within the actor tenant (no findUnique)', async () => {
    prisma.user.findFirst.mockResolvedValue({
      firstName: 'Premium',
      lastName: 'Tester',
      email: 'p@t.th',
    });
    await expect(service.nameOf({ userId: 'u1', tenantId: 't1' })).resolves.toBe('Premium Tester');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1', tenantId: 't1' } }),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to email, then null', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      firstName: null,
      lastName: null,
      email: 'p@t.th',
    });
    await expect(service.nameOf({ userId: 'u1', tenantId: 't1' })).resolves.toBe('p@t.th');
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.nameOf({ userId: 'u1', tenantId: 't1' })).resolves.toBeNull();
  });
});
