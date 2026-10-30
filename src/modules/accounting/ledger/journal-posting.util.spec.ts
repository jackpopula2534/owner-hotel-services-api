import { BadRequestException } from '@nestjs/common';
import { assertPeriodOpen, businessDayOf, fiscalPeriodOf } from './journal-posting.util';

describe('journal-posting.util', () => {
  describe('fiscalPeriodOf', () => {
    it('ตี 2 วันที่ 1 พ.ย. เวลาไทย (ยังเป็น 31 ต.ค. ใน UTC) ต้องเป็นงวด 11', () => {
      expect(fiscalPeriodOf(new Date('2026-10-31T19:00:00Z'))).toEqual({
        fiscalYear: 2026,
        fiscalPeriod: 11,
      });
    });

    it('ข้ามปีตามเวลาไทย', () => {
      expect(fiscalPeriodOf(new Date('2026-12-31T18:30:00Z'))).toEqual({
        fiscalYear: 2027,
        fiscalPeriod: 1,
      });
    });
  });

  it('businessDayOf ให้ UTC midnight ของวันตามปฏิทินไทย (เทียบกับ @db.Date ได้ตรง)', () => {
    expect(businessDayOf(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
  });

  describe('assertPeriodOpen', () => {
    const prisma = (closed: unknown) => ({
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(closed) },
    });

    it('ปฏิเสธเมื่อวันที่ตกในปีบัญชีที่ปิด/ล็อกแล้ว', async () => {
      const p = prisma({ year: 2025, status: 'LOCKED' });
      await expect(
        assertPeriodOpen(p as never, 't1', 'p1', new Date('2025-06-01')),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ผ่านเมื่อไม่มีปีบัญชีที่ปิดครอบวันนั้น (รวมถึง tenant ที่ยังไม่ตั้งปีบัญชี)', async () => {
      const p = prisma(null);
      await expect(
        assertPeriodOpen(p as never, 't1', 'p1', new Date('2026-12-31T10:00:00Z')),
      ).resolves.toBeUndefined();

      // วันสุดท้ายของปีต้องเทียบเป็นวัน ไม่ใช่เวลาเต็ม (endDate เป็น UTC midnight)
      expect(p.fiscalYear.findFirst.mock.calls[0][0].where).toMatchObject({
        tenantId: 't1',
        propertyId: 'p1',
        status: { in: ['CLOSED', 'LOCKED'] },
        endDate: { gte: new Date('2026-12-31T00:00:00.000Z') },
      });
    });
  });
});
