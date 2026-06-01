import { GuestsService } from './guests.service';

// ─────────────────────────────────────────────────────────────────────────────
// GuestsService.create - consent IP capture (LEGAL-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('GuestsService.create - consent IP', () => {
  const build = () => {
    const created: any = {};
    const prismaMock: any = {
      guest: {
        create: jest.fn(({ data }: any) => {
          Object.assign(created, data);
          return Promise.resolve({ id: 'guest-1', ...data });
        }),
      },
    };
    const auditMock: any = { logGuestCreate: jest.fn().mockResolvedValue(undefined) };
    return { service: new GuestsService(prismaMock, auditMock), created };
  };

  it('persists consentIpAddress when consent is given', async () => {
    const { service, created } = build();

    await service.create(
      { firstName: 'A', lastName: 'B', consentGiven: true } as any,
      'tenant-1',
      'user-1',
      '203.0.113.9',
    );

    expect(created.consentGiven).toBe(true);
    expect(created.consentAt).toBeInstanceOf(Date);
    expect(created.consentIpAddress).toBe('203.0.113.9');
  });

  it('does not record consent fields (incl. IP) when consent is not given', async () => {
    const { service, created } = build();

    await service.create(
      { firstName: 'A', lastName: 'B' } as any,
      'tenant-1',
      'user-1',
      '203.0.113.9',
    );

    expect(created.consentGiven).toBeUndefined();
    expect(created.consentIpAddress).toBeUndefined();
  });
});
