import { BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const base = {
  id: 'b1',
  tenantId: 't1',
  propertyId: 'p1',
  roomId: 'r1',
  guestId: 'g1',
  room: { id: 'r1', number: '402', status: 'dirty' },
  guestFirstName: 'Anna',
  guestLastName: 'Schmidt',
  status: 'confirmed',
  checkIn: new Date(),
  checkOut: new Date(Date.now() + 3 * 86_400_000),
};

function setup(booking: Record<string, any> = base) {
  const prisma: any = {
    booking: {
      findFirst: jest.fn().mockResolvedValue(booking),
      update: jest.fn().mockImplementation(({ data }) => ({ ...booking, ...data, guest: null, property: {} })),
    },
    room: { update: jest.fn().mockResolvedValue({}) },
    guest: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const ok = { catch: () => undefined };
  const audit = { log: jest.fn().mockReturnValue(Promise.resolve()) };
  const svc = new BookingsService(
    prisma,
    { emit: jest.fn() } as any,
    { onBookingCheckIn: jest.fn().mockReturnValue(Promise.resolve()) } as any,
    audit as any,
    {} as any,
    {} as any,
    {} as any,
    { create: jest.fn().mockReturnValue(Promise.resolve()), createNotification: jest.fn().mockReturnValue(Promise.resolve()) } as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(svc as any, 'findOne').mockResolvedValue(booking);
  jest.spyOn(svc as any, 'trackAnalytics').mockReturnValue(Promise.resolve());
  void ok;
  return { svc, prisma, audit };
}

describe('BookingsService.checkIn — รายละเอียดเช็คอินหน้าเดียว', () => {
  it('เก็บตรวจบัตร คีย์การ์ด เงินประกัน และเลขพาสปอร์ตเข้าโปรไฟล์แขก', async () => {
    const { svc, prisma } = setup();
    await svc.checkIn('b1', 't1', { idVerified: true, idDocumentType: 'passport', idNumber: ' C4X9 ', nationality: 'เยอรมัน', keyCards: 2, depositAmount: 1000, depositMethod: 'cash' }, 'u1');
    const data = prisma.booking.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'checked_in', idVerifiedBy: 'u1', keyCards: 2, depositAmount: 1000, depositMethod: 'cash', awaitingRoomSince: null });
    expect(data.idVerifiedAt).toBeInstanceOf(Date);
    expect(prisma.guest.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { passportNumber: 'C4X9', nationality: 'เยอรมัน' } });
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'occupied' } });
  });

  it('เช็คอินแบบรอห้อง: ไม่เปลี่ยนห้องเป็น occupied', async () => {
    const { svc, prisma } = setup();
    await svc.checkIn('b1', 't1', { awaitingRoom: true });
    expect(prisma.booking.update.mock.calls[0][0].data.awaitingRoomSince).toBeInstanceOf(Date);
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('เรียกแบบเดิม (ไม่มี body) ยังทำงานเหมือนเดิม', async () => {
    const { svc, prisma } = setup();
    await svc.checkIn('b1', 't1');
    expect(prisma.booking.update.mock.calls[0][0].data).not.toHaveProperty('keyCards');
    expect(prisma.guest.update).not.toHaveBeenCalled();
    expect(prisma.room.update).toHaveBeenCalled();
  });
});

describe('BookingsService.handOverRoom', () => {
  const waiting = { ...base, status: 'checked_in', awaitingRoomSince: new Date() };

  it('ห้องพร้อมแล้ว → ห้องเป็น occupied และเลิกสถานะรอห้อง', async () => {
    const { svc, prisma } = setup({ ...waiting, room: { id: 'r1', number: '402', status: 'available' } });
    await svc.handOverRoom('b1', 't1', 2, 'u1');
    expect(prisma.room.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'occupied' } });
    expect(prisma.booking.update.mock.calls[0][0].data).toEqual({ awaitingRoomSince: null, keyCards: 2 });
  });

  it('ห้องยังสกปรก หรือไม่ได้รอห้อง → ปฏิเสธ', async () => {
    await expect(setup(waiting).svc.handOverRoom('b1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ ...base, status: 'checked_in', room: { id: 'r1', number: '402', status: 'available' } }).svc.handOverRoom('b1', 't1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
