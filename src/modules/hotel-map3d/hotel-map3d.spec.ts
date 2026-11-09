import { NotFoundException } from '@nestjs/common';
import { buildingSlotKeys, hotelMap3dSummary, sanitizeHotelMap3dConfig } from './hotel-map3d-config';
import { HotelMap3dService, MAX_HOTEL_MAP3D_VERSIONS } from './hotel-map3d.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = {
  site: { widthM: 120, depthM: 90 },
  buildings: [
    { id: 'A', name: 'อาคาร A', preset: 'bar', x: -6, z: -6, rot: 370, floors: 5, per: 6, sides: 2, lobby: true, wall: '#EFE9DF', roof: 'flat' },
    { id: 'V', preset: 'villas', x: 999, z: 16, floors: 9, per: 3, sides: 2, lobby: true },
    { id: 'A', preset: 'tower' },
  ],
  slots: { 'A:2:0:0': 'r201', 'A:1:0:0': 'r101', 'A:2:1:5': 'r212', 'V:1:0:0': 'r201', 'V:1:0:1': 'rV2', 'X:1:0:0': 'r1', 'A:3:0:0': 'ghost' },
  props: [{ t: 'pool', x: 1, z: 2 }, { t: 'ufo', x: 0, z: 0 }],
};

describe('sanitizeHotelMap3dConfig', () => {
  const rooms = new Set(['r201', 'r212', 'rV2', 'r101']);
  const c = sanitizeHotelMap3dConfig(raw, rooms);

  it('clamps buildings and drops duplicates', () => {
    expect(c.buildings.map((b) => b.id)).toEqual(['A', 'V']);
    expect(c.buildings[0]).toMatchObject({ rot: 10, wall: '#efe9df', lobby: true });
    expect(c.buildings[1]).toMatchObject({ preset: 'villas', floors: 1, sides: 1, lobby: false, x: 60 });
  });

  it('keeps only real slots, rooms of this hotel and each room once', () => {
    // A:1 is the lobby (no slots) · X does not exist · ghost is not a room · r201 used twice
    expect(c.slots).toEqual({ 'A:2:0:0': 'r201', 'A:2:1:5': 'r212', 'V:1:0:1': 'rV2' });
  });

  it('drops unknown props and summarises', () => {
    expect(c.props).toHaveLength(1);
    expect(hotelMap3dSummary(c)).toEqual({ buildings: 2, floors: 5, slots: 4 * 12 + 3, mapped: 3, props: 1 });
    expect(buildingSlotKeys(c.buildings[1])).toEqual(['V:1:0:0', 'V:1:0:1', 'V:1:0:2']);
  });
});

function prismaMock() {
  const p: any = {
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', name: 'Mountain View', floors: 5, map3dConfig: null, map3dUpdatedAt: null, standardCheckInTime: '14:00', standardCheckOutTime: '12:00' }), update: jest.fn().mockImplementation(({ data }) => ({ id: 'p1', ...data })) },
    room: { findMany: jest.fn().mockResolvedValue([{ id: 'r201', number: '201', type: 'STD', floor: 2, status: 'occupied', price: '1800', maxOccupancy: 2 }]) },
    booking: { findMany: jest.fn().mockResolvedValue([]) },
    housekeepingTask: { findMany: jest.fn().mockResolvedValue([]) },
    maintenanceTask: { findMany: jest.fn().mockResolvedValue([]) },
    hotelMap3dVersion: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'old1' }]), deleteMany: jest.fn(), findFirst: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  p.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(p));
  return p;
}

describe('HotelMap3dService', () => {
  it('refuses a property of another tenant', async () => {
    const p = prismaMock();
    p.property.findFirst.mockResolvedValue(null);
    await expect(new HotelMap3dService(p).get('p1', 't2')).rejects.toBeInstanceOf(NotFoundException);
    expect(p.property.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', tenantId: 't2', deletedAt: null } }));
  });

  it('save: sanitises against this hotel’s rooms, keeps a version and prunes old ones', async () => {
    const p = prismaMock();
    await new HotelMap3dService(p).save('p1', 't1', raw, 'u1');
    const saved = p.property.update.mock.calls[0][0].data.map3dConfig;
    expect(saved.slots).toEqual({ 'A:2:0:0': 'r201' });
    expect(p.hotelMap3dVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({ propertyId: 'p1', createdBy: 'u1' }) });
    expect(p.hotelMap3dVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: MAX_HOTEL_MAP3D_VERSIONS }));
    expect(p.hotelMap3dVersion.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['old1'] } } });
  });

  it('board: balance prefers the open folio and maps rooms/tasks', async () => {
    const p = prismaMock();
    p.booking.findMany.mockResolvedValue([
      {
        id: 'b1', bookingNo: 'BK-1', roomId: 'r201', guestFirstName: 'Daniel', guestLastName: 'K', guestPhone: null, adults: 2, children: 1,
        checkIn: new Date('2026-10-23T07:00:00Z'), checkOut: new Date('2026-10-25T05:00:00Z'), status: 'checked_in', totalPrice: '3600', grandTotal: '4000',
        amountPaid: '1000', paymentStatus: 'partial', source: 'DIRECT', notes: null, approvedEarlyCheckIn: false, approvedLateCheckOut: true,
        guest: { isVip: true, vipLevel: 'gold' }, guestFolios: [{ balance: '3500' }],
      },
    ]);
    p.maintenanceTask.findMany.mockResolvedValue([{ id: 'm1', roomId: 'r201', title: 'แอร์', category: 'ac', priority: 'high', status: 'pending', assignedTo: { firstName: 'เอก', lastName: 'ช่าง' }, createdAt: new Date() }]);
    const res = await new HotelMap3dService(p).board('p1', 't1');
    expect(res.data.rooms[0].price).toBe(1800);
    expect(res.data.stays[0]).toMatchObject({ guestName: 'Daniel K', guests: 3, vip: true, total: 4000, paid: 1000, balance: 3500, lateCheckOut: true, checkIn: '2026-10-23' });
    expect(res.data.maintenance[0].assigneeName).toBe('เอก ช่าง');
  });
});
