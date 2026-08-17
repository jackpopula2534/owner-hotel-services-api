/**
 * คืนพักของเดือน — ตัวหารของ occupancy / RevPAR / ต้นทุนต่อห้องที่ขายได้
 *
 * สองเรื่องที่ต้องล็อก: ขอบเดือนต้องเป็นวันไทย (ของเดิมใช้เวลาท้องถิ่นของเครื่อง
 * ซึ่งบน server ที่รันเป็น UTC จะกวาดใบจองคืนสิ้นเดือนก่อนหน้าเข้ามาด้วย) และ
 * property ที่ยังไม่ได้ตั้งห้องต้องได้ 0 ไม่ใช่หารด้วย 1 ห้องปลอมจนตัวเลขบานปลาย
 */
import { PrismaService } from '@/prisma/prisma.service';
import { nightsBetween, occupiedRoomNights } from '../room-nights';

const TENANT = 'tenant-1';
const PROPERTY = 'prop-1';

interface BookingRow {
  scheduledCheckIn: Date;
  scheduledCheckOut: Date;
}

function makeWorld(bookings: BookingRow[], roomCount: number) {
  const count = jest.fn(async () => roomCount);
  const findMany = jest.fn(async () => bookings);
  const prisma = {
    room: { count },
    booking: { findMany },
  } as unknown as PrismaService;

  return {
    count,
    findMany,
    run: (period = '2026-08') =>
      occupiedRoomNights(prisma, { tenantId: TENANT, propertyId: PROPERTY, period }),
  };
}

const stay = (checkIn: string, checkOut: string): BookingRow => ({
  scheduledCheckIn: new Date(checkIn),
  scheduledCheckOut: new Date(checkOut),
});

describe('nightsBetween', () => {
  it('นับจำนวนคืนแบบปัดขึ้น เข้าบ่ายออกเช้ายังเป็น 1 คืน', () => {
    expect(nightsBetween(new Date('2026-08-07T07:00:00Z'), new Date('2026-08-08T05:00:00Z'))).toBe(1);
    expect(nightsBetween(new Date('2026-08-07T07:00:00Z'), new Date('2026-08-10T05:00:00Z'))).toBe(3);
  });

  it('เข้าออกวันเดียวกันยังคิดเป็น 1 คืน ไม่ใช่ 0 ที่ทำให้ occupancy หายไปทั้งใบ', () => {
    expect(nightsBetween(new Date('2026-08-07T07:00:00Z'), new Date('2026-08-07T18:00:00Z'))).toBe(1);
  });
});

describe('occupiedRoomNights', () => {
  it('คืนที่ขายได้ = จำนวนห้อง × จำนวนวันในเดือน', async () => {
    const { run } = makeWorld([], 10);

    const result = await run('2026-08');

    expect(result.totalNights).toBe(310);
  });

  it('เดือนกุมภาพันธ์ปีอธิกสุรทินได้ 29 วัน ไม่ใช่ 28 หรือ 30 ตายตัว', async () => {
    const { run } = makeWorld([], 10);

    const result = await run('2028-02');

    expect(result.totalNights).toBe(290);
  });

  it('บวกคืนของทุกใบจองแล้วคิดเป็นเปอร์เซ็นต์', async () => {
    const { run } = makeWorld(
      [
        stay('2026-08-07T07:00:00Z', '2026-08-10T05:00:00Z'),
        stay('2026-08-11T07:00:00Z', '2026-08-13T05:00:00Z'),
      ],
      1,
    );

    const result = await run('2026-08');

    expect(result.occupiedNights).toBe(5);
    expect(result.rate).toBeCloseTo((5 / 31) * 100, 6);
  });

  it('ตัดเดือนที่เที่ยงคืนเวลาไทย ไม่ใช่เวลาท้องถิ่นของเครื่อง', async () => {
    const { run, findMany } = makeWorld([], 10);

    await run('2026-08');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          propertyId: PROPERTY,
          scheduledCheckIn: {
            gte: new Date('2026-07-31T17:00:00.000Z'),
            lt: new Date('2026-08-31T17:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('property ที่ยังไม่ได้ตั้งห้องได้ 0 ไม่ใช่หารด้วยห้องปลอม 1 ห้อง', async () => {
    const { run } = makeWorld([stay('2026-08-07T07:00:00Z', '2026-08-10T05:00:00Z')], 0);

    const result = await run('2026-08');

    expect(result.totalNights).toBe(0);
    expect(result.rate).toBe(0);
    // คืนที่นับได้ยังรายงานตามจริง เพื่อให้เห็นว่าข้อมูลห้องต่างหากที่ขาด
    expect(result.occupiedNights).toBe(3);
  });

  it('นับห้องของ property ไม่ใช่ห้องทั้ง tenant', async () => {
    const { run, count } = makeWorld([], 10);

    await run('2026-08');

    expect(count).toHaveBeenCalledWith({ where: { propertyId: PROPERTY } });
  });
});
