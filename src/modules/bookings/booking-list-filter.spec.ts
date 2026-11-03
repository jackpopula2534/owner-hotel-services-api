import { BadRequestException } from '@nestjs/common';
import { buildBookingListWhere } from './booking-list-filter';

// 2026-11-03 01:30 เวลาไทย = 2026-11-02 18:30Z — เครื่องที่ตัดวันแบบ UTC จะได้ "เมื่อวาน"
const NOW = new Date('2026-11-02T18:30:00.000Z');
const DAY_START = new Date('2026-11-02T17:00:00.000Z');
const DAY_END = new Date('2026-11-03T17:00:00.000Z');

describe('buildBookingListWhere', () => {
  it('เช็คเอาท์วันนี้: checkOut=today + checked_in ตรงกับ departuresToday ของ dashboard', () => {
    expect(
      buildBookingListWhere({ propertyId: 'p1', checkOut: 'today', status: 'checked_in' }, 't1', NOW),
    ).toEqual({
      tenantId: 't1',
      propertyId: 'p1',
      status: 'checked_in',
      checkOut: { gte: DAY_START, lt: DAY_END },
    });
  });

  it('เช็คอินวันนี้: status หลายค่าคั่นด้วย comma → in', () => {
    const where = buildBookingListWhere({ checkIn: 'today', status: 'confirmed, pending' }, 't1', NOW);
    expect(where.status).toEqual({ in: ['confirmed', 'pending'] });
    expect(where.checkIn).toEqual({ gte: DAY_START, lt: DAY_END });
  });

  it('วันที่ระบุตรง ๆ ตัดที่เที่ยงคืนไทย', () => {
    expect(buildBookingListWhere({ checkOut: '2026-11-03' }, 't1', NOW).checkOut).toEqual({
      gte: DAY_START,
      lt: DAY_END,
    });
  });

  it('ช่วงวันเช็คอิน from–to รวมวันสุดท้าย', () => {
    expect(
      buildBookingListWhere({ checkInFrom: '2026-11-01', checkInTo: '2026-11-03' }, 't1', NOW).checkIn,
    ).toEqual({ gte: new Date('2026-10-31T17:00:00.000Z'), lt: DAY_END });
  });

  it('วันที่ผิดรูปแบบหรือ from > to → 400', () => {
    expect(() => buildBookingListWhere({ checkOut: 'yesterday' }, 't1', NOW)).toThrow(BadRequestException);
    expect(() =>
      buildBookingListWhere({ checkInFrom: '2026-11-04', checkInTo: '2026-11-03' }, 't1', NOW),
    ).toThrow(BadRequestException);
  });

  it('ไม่มีตัวกรองวันที่ → ไม่ใส่ checkIn/checkOut', () => {
    expect(buildBookingListWhere({ search: 'Ann' }, 't1', NOW)).toEqual({
      tenantId: 't1',
      OR: expect.any(Array),
    });
  });
});
