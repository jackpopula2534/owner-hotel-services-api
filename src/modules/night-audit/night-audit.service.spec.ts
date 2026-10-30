import { BadRequestException } from '@nestjs/common';
import { NightAuditService } from './night-audit.service';

/**
 * Night Audit ↔ GL: ปิดวันต้องได้ JE NIGHT_AUDIT ที่สมดุล และไม่ลงค่าห้องของการจอง
 * ที่เช็คเอาต์ไปแล้ว (เช็คเอาต์รับรู้รายได้เองแล้วใน BOOKING_PAYMENT)
 */
describe('NightAuditService', () => {
  const TENANT = 't1';
  let prisma: any;
  let journal: any;
  let folioPosting: any;
  let service: NightAuditService;

  beforeEach(() => {
    prisma = {
      nightAudit: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'na1', ...data })),
        count: jest.fn().mockResolvedValue(0),
      },
      folioCharge: { findMany: jest.fn().mockResolvedValue([]) },
      journalEntry: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      accountChart: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              (where.code.in as string[]).map((code) => ({ id: `acc-${code}`, code, name: code })),
            ),
          ),
        count: jest.fn().mockResolvedValue(10),
      },
      cashDrawer: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      guestFolio: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { balance: null } }),
      },
    };
    journal = {
      createAndPostAutoEntry: jest.fn().mockResolvedValue({ id: 'je1', entryNo: 'JE-1' }),
      create: jest.fn().mockResolvedValue({ id: 'je-draft' }),
    };
    folioPosting = { openFolioForBooking: jest.fn() };
    service = new NightAuditService(prisma, journal, folioPosting);
  });

  const audit = {
    id: 'na1',
    tenantId: TENANT,
    propertyId: 'p1',
    auditDate: new Date('2026-10-29T00:00:00Z'),
    status: 'COMPLETED',
    journalEntryId: null,
    charges: [],
  };

  const charge = (chargeType: string, net: number, bookingId = 'b1') => ({
    chargeType,
    netAmount: net,
    vatAmount: Math.round(net * 7) / 100,
    totalAmount: Math.round(net * 107) / 100,
    folio: { bookingId },
  });

  describe('preCheck', () => {
    it('ลิ้นชักยังเปิด หรือห้องเลยเวลาเช็คเอาต์ → BLOCK', async () => {
      prisma.nightAudit.findFirst.mockResolvedValue(null);
      prisma.cashDrawer.findMany.mockResolvedValue([
        { code: 'FD-02', name: 'กะบ่าย', status: 'OPEN' },
      ]);
      prisma.booking.findMany.mockResolvedValue([{ bookingNo: 'BK1', room: { number: '214' } }]);

      const res = await service.preCheck(TENANT, 'p1', '2026-10-29');

      expect(res.canRun).toBe(false);
      expect(res.items.filter((i) => i.level === 'BLOCK').map((i) => i.key)).toEqual([
        'cash-drawers-open',
        'overdue-departures',
      ]);
    });

    it('ทุกอย่างพร้อม → canRun', async () => {
      prisma.nightAudit.findFirst.mockResolvedValue(null);
      const res = await service.preCheck(TENANT, 'p1', '2026-10-29');
      expect(res.canRun).toBe(true);
    });

    it('ไม่ส่ง propertyId → 400', async () => {
      await expect(service.preCheck(TENANT, '', '2026-10-29')).rejects.toThrow(BadRequestException);
    });
  });

  describe('journalPreview', () => {
    it('ตัดค่าห้องของการจองที่เช็คเอาต์ลง JE แล้ว แต่ยังลงรายการ POS ของการจองนั้น', async () => {
      prisma.nightAudit.findFirst.mockResolvedValue(audit);
      prisma.folioCharge.findMany.mockResolvedValue([
        charge('ROOM_CHARGE', 2450, 'b1'),
        charge('ROOM_CHARGE', 2450, 'b2'),
        charge('FB_CHARGE', 1000, 'b2'),
      ]);
      prisma.journalEntry.findMany.mockResolvedValue([{ sourceId: 'b2' }]);

      const p = await service.journalPreview('na1', TENANT);

      expect(p.excludedCount).toBe(1);
      expect(p.excludedAmount).toBe(2621.5);
      expect(p.lines.find((l) => l.code === '4101')?.credit).toBe(2450);
      expect(p.lines.find((l) => l.code === '4201')?.credit).toBe(1000);
      expect(p.totalDebit).toBe(p.totalCredit);
      expect(p.totalDebit).toBe(3691.5);
    });
  });

  describe('close', () => {
    beforeEach(() => {
      prisma.nightAudit.findFirst.mockResolvedValue(audit);
      prisma.folioCharge.findMany.mockResolvedValue([charge('ROOM_CHARGE', 2450)]);
    });

    it('โพสต์ JE NIGHT_AUDIT แล้วผูก journalEntryId และปิด audit', async () => {
      const res = await service.close('na1', TENANT, 'u1');

      expect(journal.createAndPostAutoEntry).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          sourceType: 'NIGHT_AUDIT',
          sourceId: 'na1',
          entryDate: '2026-10-29',
          reference: 'NA-2026-10-29',
        }),
      );
      const lines = journal.createAndPostAutoEntry.mock.calls[0][1].lines;
      expect(lines[0]).toMatchObject({ accountId: 'acc-1103', debit: 2621.5 });
      expect(res).toMatchObject({ status: 'CLOSED', journalEntryId: 'je1' });
    });

    it('postJournal=false → สร้าง DRAFT ให้ฝ่ายบัญชีตรวจ', async () => {
      await service.close('na1', TENANT, 'u1', { postJournal: false });
      expect(journal.create).toHaveBeenCalled();
      expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
    });

    it('ไม่มีรายได้ → ปิดได้โดยไม่สร้าง JE', async () => {
      prisma.folioCharge.findMany.mockResolvedValue([]);
      const res = await service.close('na1', TENANT, 'u1');
      expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'CLOSED', journalEntryId: null });
    });

    it('audit ที่ยังไม่ COMPLETED ปิดไม่ได้', async () => {
      prisma.nightAudit.findFirst.mockResolvedValue({ ...audit, status: 'IN_PROGRESS' });
      await expect(service.close('na1', TENANT, 'u1')).rejects.toThrow(BadRequestException);
    });
  });
});
