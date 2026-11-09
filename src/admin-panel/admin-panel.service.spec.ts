import { AdminPanelService } from './admin-panel.service';

describe('AdminPanelService.getDashboard', () => {
  const now = new Date();
  const tenants = [
    {
      id: 't1',
      name: 'Mountain View Resort',
      status: 'active',
      created_at: new Date(now.getFullYear(), now.getMonth(), 1, 9),
    },
    { id: 't2', name: 'Pine Valley Camp', status: 'trial', created_at: new Date('2026-01-01') },
  ];
  const subscriptions = [
    {
      tenant_id: 't1',
      status: 'active',
      billing_cycle: 'monthly',
      created_at: new Date('2026-02-01'),
      plans_subscriptions_plan_idToplans: {
        name: 'Business',
        price_monthly: 2490,
        price_yearly: 24900,
      },
    },
    {
      tenant_id: 't2',
      status: 'active',
      billing_cycle: 'yearly',
      created_at: new Date('2026-02-01'),
      plans_subscriptions_plan_idToplans: {
        name: 'Starter',
        price_monthly: 990,
        price_yearly: 12000,
      },
    },
  ];
  const payments = [
    {
      id: 'p1',
      status: 'pending',
      amount: '2490.00',
      method: 'transfer',
      slip_url: 'https://x/slip.jpg',
      created_at: new Date(),
      invoice_id: 'inv1',
      invoices: {
        id: 'inv1',
        invoice_no: 'INV-1',
        tenants: { name: 'Mountain View Resort' },
        subscriptions: null,
      },
    },
    { id: 'p2', status: 'approved', amount: '100', created_at: new Date(), invoices: null },
  ];
  const trialCount = jest.fn();

  const service = new AdminPanelService(
    { findAll: jest.fn().mockResolvedValue(tenants) } as any,
    { findAll: jest.fn().mockResolvedValue(subscriptions) } as any,
    { findAll: jest.fn().mockResolvedValue([]) } as any,
    { findAll: jest.fn().mockResolvedValue(payments) } as any,
    { findAll: jest.fn().mockResolvedValue([]) } as any,
    { addon_trial_requests: { count: trialCount } } as any,
  );

  it('returns the KPI stats the admin dashboard reads, incl. pending add-on trial requests', async () => {
    trialCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const d = await service.getDashboard();
    expect(trialCount).toHaveBeenCalledWith({ where: { status: 'pending' } });
    expect(d.stats).toEqual({
      totalHotels: 2,
      newHotelsThisMonth: 1,
      activeSubscriptions: 2,
      trialCount: 1,
      trialRequestsToday: 1,
      monthlyRevenue: 3490, // 2490 + 12000/12
      pendingPayments: 1,
    });
    expect(d.pendingPayments).toEqual([
      expect.objectContaining({
        id: 'p1',
        amount: 2490,
        invoiceNumber: 'INV-1',
        hotel: { name: 'Mountain View Resort' },
      }),
    ]);
    expect(d.recentHotels[0]).toMatchObject({ id: 't1', plan: { name: 'Business' } });
  });
});
