import { FolioPostingService } from '../folio-posting.service';

/** เช็คอิน → เปิด folio บัญชี, เช็คเอาต์ → เคลียร์ค่าห้อง แล้ว CLOSED หรือ PENDING ถ้ายังค้าง POS */
describe('FolioPostingService · booking lifecycle', () => {
  const TENANT = 't1';
  let prisma: any;
  let service: FolioPostingService;

  beforeEach(() => {
    prisma = {
      booking: { findFirst: jest.fn() },
      guestFolio: {
        findFirst: jest.fn(),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'f-new', ...data })),
        update: jest.fn().mockResolvedValue({}),
        findFirstOrThrow: jest.fn(),
      },
      folioPayment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      folioCharge: { aggregate: jest.fn() },
      documentSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 7 }) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    service = new FolioPostingService(prisma);
  });

  describe('openFolioForBooking', () => {
    it('เช็คอินแล้ว ยังไม่มี folio → เปิดใหม่', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'b1',
        guestId: 'g1',
        propertyId: 'p1',
        roomId: 'r1',
        checkIn: new Date('2026-10-27T07:00:00Z'),
        status: 'checked_in',
      });
      prisma.guestFolio.findFirst.mockResolvedValue(null);
      const res = await service.openFolioForBooking(TENANT, 'b1', 'system');
      expect(res).toEqual({ folioId: 'f-new', created: true });
      expect(prisma.guestFolio.create.mock.calls[0][0].data).toMatchObject({
        bookingId: 'b1',
        status: 'OPEN',
        checkInDate: new Date('2026-10-27T00:00:00.000Z'),
      });
    });

    it('ไม่มีแขกผูก หรือยังไม่เช็คอิน → ไม่เปิด', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: 'b1', guestId: null, status: 'checked_in' });
      await expect(service.openFolioForBooking(TENANT, 'b1', 'system')).resolves.toBeNull();
    });
  });

  describe('settleFolioOnCheckout', () => {
    beforeEach(() => {
      prisma.guestFolio.findFirst.mockResolvedValue({ id: 'f1', propertyId: 'p1' });
      prisma.folioCharge.aggregate.mockResolvedValue({ _sum: { totalAmount: 7864.5 } });
    });

    it('เคลียร์ค่าห้องแล้วไม่เหลือยอด → CLOSED', async () => {
      prisma.guestFolio.findFirstOrThrow.mockResolvedValue({ balance: 0 });
      const res = await service.settleFolioOnCheckout(TENANT, 'b1', 'system');
      expect(prisma.folioPayment.create.mock.calls[0][0].data).toMatchObject({
        amount: 7864.5,
        reference: 'BOOKING-CHECKOUT:b1',
      });
      expect(res).toMatchObject({ status: 'CLOSED' });
    });

    it('ยังค้างค่า POS → PENDING', async () => {
      prisma.guestFolio.findFirstOrThrow.mockResolvedValue({ balance: 1337.5 });
      const res = await service.settleFolioOnCheckout(TENANT, 'b1', 'system');
      expect(res).toMatchObject({ status: 'PENDING', balance: 1337.5 });
    });

    it('เคลียร์ไปแล้ว (event ซ้ำ) → ไม่สร้างรายการซ้ำ', async () => {
      prisma.folioPayment.findFirst.mockResolvedValue({ id: 'old' });
      prisma.guestFolio.findFirstOrThrow.mockResolvedValue({ balance: 0 });
      await service.settleFolioOnCheckout(TENANT, 'b1', 'system');
      expect(prisma.folioPayment.create).not.toHaveBeenCalled();
    });
  });
});
