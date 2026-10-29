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

describe('ProductChangeNotifierService notifications', () => {
  const prisma = { user: { findMany: jest.fn() } };
  const notifications = { create: jest.fn() };
  const service = new ProductChangeNotifierService(
    prisma as never,
    notifications as never,
    { log: jest.fn() } as never,
  );
  const request = {
    id: 'req-1',
    tenantId: 't1',
    requestNumber: 'PCR-202610-0001',
    requestedById: 'buyer-1',
  } as never;

  beforeEach(() => jest.clearAllMocks());

  it('notifies every reviewer role (owners included), skips the requester, links to the inventory page', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'owner-1' }, { id: 'buyer-1' }]);

    await service.notifyReviewers(request, 'ขอสร้างสินค้าใหม่: ไข่ไก่');

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.role.in).toEqual(
      expect.arrayContaining(['warehouse_manager', 'tenant_admin', 'owner']),
    );
    expect(where.role.in).not.toContain('platform_admin');
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner-1',
        category: 'inventory',
        link: '/inventory/product-requests/req-1',
      }),
    );
  });

  it('notifies the requester in the procurement module with a link back', async () => {
    await service.notifyRequester(request, 'คลังปฏิเสธคำขอ: ซ้ำ', 'error');

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'buyer-1',
        type: 'error',
        category: 'procurement',
        link: '/purchasing/product-requests/req-1',
      }),
    );
  });

  it('swallows delivery errors so the review itself never fails', async () => {
    notifications.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.notifyRequester(request, 'x')).resolves.toBeUndefined();
  });
});
