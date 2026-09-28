import { TonightBoardService, coversTonight, resolveTonightStatus } from './tonight-board.service';

// 13:00 Bangkok on 2026-09-28 → Bangkok "today" = 2026-09-28
const NOW = new Date('2026-09-28T06:00:00.000Z');
const TODAY_START = new Date('2026-09-27T17:00:00.000Z'); // 00:00 BKK 28th
const TOMORROW_START = new Date('2026-09-28T17:00:00.000Z'); // 00:00 BKK 29th
const d = (iso: string) => new Date(iso);

describe('coversTonight', () => {
  it('a guest checking out today is not staying tonight', () => {
    expect(coversTonight(d('2026-09-26T00:00:00Z'), d('2026-09-28T00:00:00Z'), TOMORROW_START)).toBe(false);
  });
  it('a guest arriving today and leaving tomorrow is', () => {
    expect(coversTonight(d('2026-09-28T00:00:00Z'), d('2026-09-29T00:00:00Z'), TOMORROW_START)).toBe(true);
  });
  it('a guest arriving tomorrow is not', () => {
    expect(coversTonight(d('2026-09-29T00:00:00Z'), d('2026-09-30T00:00:00Z'), TOMORROW_START)).toBe(false);
  });
});

describe('resolveTonightStatus', () => {
  const stay = (status: string, checkIn: string) => ({ status, checkIn: d(checkIn), checkOut: d('2026-09-30T00:00:00Z'), guestName: 'A' });

  it('maintenance / closed always win', () => {
    expect(resolveTonightStatus('maintenance', stay('checked_in', '2026-09-27T00:00:00Z'), TODAY_START)).toBe('blocked');
    expect(resolveTonightStatus('closed', undefined, TODAY_START)).toBe('blocked');
  });
  it('checked-in stay → occupied', () => {
    expect(resolveTonightStatus('available', stay('checked_in', '2026-09-27T00:00:00Z'), TODAY_START)).toBe('occupied');
  });
  it('booked for today, not checked in → arriving', () => {
    expect(resolveTonightStatus('available', stay('confirmed', '2026-09-28T00:00:00Z'), TODAY_START)).toBe('arriving');
  });
  it('booked from before today, not checked in → reserved', () => {
    expect(resolveTonightStatus('available', stay('pending', '2026-09-26T00:00:00Z'), TODAY_START)).toBe('reserved');
  });
  it('no stay: cleaning → dirty, otherwise available', () => {
    expect(resolveTonightStatus('cleaning', undefined, TODAY_START)).toBe('dirty');
    expect(resolveTonightStatus('available', undefined, TODAY_START)).toBe('available');
  });
});

describe('TonightBoardService (camp)', () => {
  const pitch = (id: string, code: string, zone: string, status = 'available') => ({
    id, code, status,
    zone: { id: `z-${zone}`, name: `โซน ${zone}`, code: zone, type: 'lawn', color: null },
    campground: { id: 'cg1', name: 'Doi Fah' },
  });

  const prisma = {
    room: { count: jest.fn().mockResolvedValue(0) },
    campPitch: {
      count: jest.fn().mockResolvedValue(4),
      findMany: jest.fn().mockResolvedValue([
        pitch('p1', 'A10', 'A'), pitch('p2', 'A2', 'A'), pitch('p3', 'B1', 'B', 'maintenance'), pitch('p4', 'B2', 'B'),
      ]),
    },
    campReservation: {
      findMany: jest
        .fn()
        // tonight's stays
        .mockResolvedValueOnce([
          { pitchId: 'p2', status: 'checked_in', checkIn: d('2026-09-27T00:00:00Z'), checkOut: d('2026-09-30T00:00:00Z'), guestFirstName: 'ณัฐวุฒิ', guestLastName: null },
          { pitchId: 'p4', status: 'confirmed', checkIn: d('2026-09-28T00:00:00Z'), checkOut: d('2026-09-30T00:00:00Z'), guestFirstName: 'Beam', guestLastName: 'K' },
        ])
        // recent activity
        .mockResolvedValueOnce([
          {
            id: 'r1', status: 'confirmed', checkIn: d('2026-09-28T00:00:00Z'), checkOut: d('2026-09-30T00:00:00Z'),
            actualCheckIn: null, actualCheckOut: null,
            createdAt: d('2026-09-27T03:00:00Z'), updatedAt: d('2026-09-28T05:00:00Z'),
            guestFirstName: 'ณัฐวุฒิ', guestLastName: null, totalPrice: 1200,
            payments: [{ at: '2026-09-28T05:00:00Z', amount: 500, method: 'promptpay' }],
            pitch: { code: 'A-03' },
          },
        ]),
    },
  };

  it('groups pitches by zone with tonight statuses and a payment-first feed', async () => {
    const svc = new TonightBoardService(prisma as never);
    const board = await svc.getBoard('t1', { now: NOW });

    expect(board.line).toBe('CAMP');
    expect(board.groups.map((g) => g.label)).toEqual(['โซน A', 'โซน B']);
    expect(board.groups[0].units.map((u) => [u.code, u.status])).toEqual([['A2', 'occupied'], ['A10', 'available']]);
    expect(board.groups[1].units.map((u) => [u.code, u.status])).toEqual([['B1', 'blocked'], ['B2', 'arriving']]);
    expect(board.summary).toMatchObject({ total: 4, occupied: 1, arriving: 1, blocked: 1, available: 1 });

    expect(board.activity[0]).toMatchObject({ kind: 'payment', guestName: 'ณัฐวุฒิ', unit: 'A-03', amount: 500, method: 'promptpay', nights: 2 });
    expect(board.activity[1]).toMatchObject({ kind: 'booked' });
  });
});
