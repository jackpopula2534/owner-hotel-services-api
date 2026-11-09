// audit 2026-11-09 M1 — public QR guest lookup used to match 2+ characters of a
// name and return the guest id; the public order trusted any guestId.
import { BadRequestException } from '@nestjs/common';
import { OrderService } from '../order.service';
import {
  QR_GUEST_TOKEN_TTL_SECONDS,
  phoneLast4,
  signQrGuestToken,
  verifyQrGuestToken,
} from '../qr-guest-token';

const SECRET = 'test-secret';
const R = 'rest-1';
const T = 'tenant-1';

describe('qr-guest-token', () => {
  const tok = () => signQrGuestToken({ guestId: 'g-1', restaurantId: R, tenantId: T }, SECRET, 1_000_000);

  it('round-trips for the same restaurant + tenant', () => {
    expect(verifyQrGuestToken(tok(), { restaurantId: R, tenantId: T }, SECRET, 1_000_000)).toEqual({
      guestId: 'g-1',
      restaurantId: R,
      tenantId: T,
    });
  });

  it('rejects another restaurant / tenant', () => {
    expect(verifyQrGuestToken(tok(), { restaurantId: 'rest-2', tenantId: T }, SECRET, 1_000_000)).toBeNull();
    expect(verifyQrGuestToken(tok(), { restaurantId: R, tenantId: 'tenant-2' }, SECRET, 1_000_000)).toBeNull();
  });

  it('rejects an expired token', () => {
    const later = 1_000_000 + (QR_GUEST_TOKEN_TTL_SECONDS + 1) * 1000;
    expect(verifyQrGuestToken(tok(), { restaurantId: R, tenantId: T }, SECRET, later)).toBeNull();
  });

  it('rejects a forged / tampered token and a wrong secret', () => {
    const [body, sig] = tok().split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ guestId: 'g-9', restaurantId: R, tenantId: T, exp: 9e9 }),
    ).toString('base64url');
    expect(verifyQrGuestToken(`${forgedBody}.${sig}`, { restaurantId: R, tenantId: T }, SECRET)).toBeNull();
    expect(verifyQrGuestToken(`${body}.${sig}`, { restaurantId: R, tenantId: T }, 'other', 1_000_000)).toBeNull();
    expect(verifyQrGuestToken('g-1', { restaurantId: R, tenantId: T }, SECRET)).toBeNull();
    expect(verifyQrGuestToken(undefined, { restaurantId: R, tenantId: T }, SECRET)).toBeNull();
  });

  it('phoneLast4 ignores formatting', () => {
    expect(phoneLast4('+66 81-234-5678')).toBe('5678');
    expect(phoneLast4('12')).toBeNull();
    expect(phoneLast4(null)).toBeNull();
  });
});

describe('OrderService — public guest lookup / QR order', () => {
  const guestFindMany = jest.fn();
  const guestFindFirst = jest.fn();
  const prisma = {
    restaurant: { findFirst: jest.fn().mockResolvedValue({ id: R, tenantId: T }) },
    restaurantTable: { findFirst: jest.fn().mockResolvedValue({ id: 'tb-1' }) },
    guest: { findMany: guestFindMany, findFirst: guestFindFirst },
    order: { update: jest.fn() },
  };
  const config = { getOrThrow: jest.fn().mockReturnValue(SECRET), get: jest.fn() };
  const service = new OrderService(
    prisma as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const somchai = { id: 'g-1', firstName: 'Somchai', lastName: 'Jaidee', isVip: false, phone: '081-234-5678' };

  beforeEach(() => {
    guestFindMany.mockReset();
    guestFindFirst.mockReset();
  });

  it('queries by EXACT first + last name, never `contains`', async () => {
    guestFindMany.mockResolvedValue([somchai]);
    await service.lookupGuest(R, { firstName: 'Somchai', lastName: 'Jaidee', phoneLast4: '5678' });
    const where = guestFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: T, firstName: 'Somchai', lastName: 'Jaidee' });
    expect(JSON.stringify(where)).not.toContain('contains');
  });

  it('matches only when the phone last 4 also match, and never returns the guest id', async () => {
    guestFindMany.mockResolvedValue([somchai]);
    const ok = await service.lookupGuest(R, { firstName: 'Somchai', lastName: 'Jaidee', phoneLast4: '5678' });
    expect(ok.matched).toBe(true);
    expect(ok.guest).toEqual({ firstName: 'Somchai', lastName: 'Jaidee', isVip: false });
    expect(JSON.stringify(ok)).not.toContain('g-1');
    expect(typeof ok.guestToken).toBe('string');

    const bad = await service.lookupGuest(R, { firstName: 'Somchai', lastName: 'Jaidee', phoneLast4: '0000' });
    expect(bad).toEqual({ matched: false });
  });

  it('ambiguous match (same name + last 4) reveals nothing', async () => {
    guestFindMany.mockResolvedValue([somchai, { ...somchai, id: 'g-2' }]);
    expect(
      await service.lookupGuest(R, { firstName: 'Somchai', lastName: 'Jaidee', phoneLast4: '5678' }),
    ).toEqual({ matched: false });
  });

  it('rejects partial input (the old 2-character name search)', async () => {
    await expect(
      service.lookupGuest(R, { firstName: 'So', lastName: '', phoneLast4: '' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a raw guestId on the public order is ignored — no guest lookup, no discount', async () => {
    const create = jest.spyOn(service, 'create').mockResolvedValue({ id: 'o-1', subtotal: 100 } as never);
    await service.createPublicOrder(R, 'tb-1', { guestId: 'g-1', items: [{ menuItemId: 'm', quantity: 1 }] });
    expect(guestFindFirst).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('a forged guestToken is refused', async () => {
    await expect(
      service.createPublicOrder(R, 'tb-1', { guestToken: 'x.y', items: [{ menuItemId: 'm', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a valid guestToken resolves the guest', async () => {
    const token = signQrGuestToken({ guestId: 'g-1', restaurantId: R, tenantId: T }, SECRET);
    guestFindFirst.mockResolvedValue(somchai);
    const create = jest
      .spyOn(service, 'create')
      .mockResolvedValue({ id: 'o-1', subtotal: 100, taxRate: 0, serviceRate: 0 } as never);
    prisma.order.update.mockResolvedValue({ id: 'o-1' });
    await service.createPublicOrder(R, 'tb-1', { guestToken: token, items: [{ menuItemId: 'm', quantity: 1 }] });
    expect(guestFindFirst).toHaveBeenCalledWith({ where: { id: 'g-1', tenantId: T } });
    expect(create.mock.calls[0][1]).toMatchObject({ guestName: 'Somchai Jaidee' });
    create.mockRestore();
  });
});
