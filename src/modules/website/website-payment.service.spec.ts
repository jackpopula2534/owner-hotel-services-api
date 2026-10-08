import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { PromptPayService } from '../../promptpay/promptpay.service';
import { StorageService } from '../../common/storage/storage.service';
import { WebsitePublicService } from './website-public.service';
import { WebsitePaymentService } from './website-payment.service';

const site = { id: 'site-1', tenantId: 'tenant-1', propertyId: 'prop-1' };
const tx = {
  id: 'tx-1',
  tenantId: 'tenant-1',
  bookingId: 'booking-1234',
  invoiceId: 'inv-1',
  transactionRef: 'PPREF',
  amount: 3531,
  status: 'pending',
  expiresAt: new Date(Date.now() + 60_000),
};
const png = { buffer: Buffer.from('png'), originalname: 's.png', mimetype: 'image/png', size: 3 };

describe('WebsitePaymentService', () => {
  let prisma: {
    paymentAccount: { findFirst: jest.Mock };
    invoices: { findFirst: jest.Mock; findMany: jest.Mock };
    promptPayTransaction: { findFirst: jest.Mock };
    booking: { findFirst: jest.Mock; findMany: jest.Mock };
    payments: { findFirst: jest.Mock; update: jest.Mock };
  };
  let promptPay: { generateQRCode: jest.Mock };
  let storage: { save: jest.Mock };
  let publicSites: { findPublishedSite: jest.Mock; notifyStaff: jest.Mock };
  let service: WebsitePaymentService;

  beforeEach(() => {
    prisma = {
      paymentAccount: { findFirst: jest.fn() },
      invoices: {
        findFirst: jest.fn().mockResolvedValue({ id: 'inv-1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'inv-1', booking_id: 'booking-1234' }]),
      },
      promptPayTransaction: { findFirst: jest.fn().mockResolvedValue(tx) },
      booking: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'booking-1234',
          status: 'pending',
          guestFirstName: 'A',
          guestLastName: 'B',
        }),
        findMany: jest.fn(),
      },
      payments: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pay-1', slip_url: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    promptPay = {
      generateQRCode: jest.fn().mockResolvedValue({
        transactionRef: 'PPREF',
        qrCodeImage: 'data:image/png;base64,AA',
        amount: 3531,
        promptpayId: '081****678',
        expiresAt: tx.expiresAt,
      }),
    };
    storage = { save: jest.fn().mockResolvedValue({ path: '/uploads/payment-slips/x.png' }) };
    publicSites = {
      findPublishedSite: jest.fn().mockResolvedValue(site),
      notifyStaff: jest.fn().mockResolvedValue(undefined),
    };
    service = new WebsitePaymentService(
      prisma as unknown as PrismaService,
      { get: () => 'test-secret' } as unknown as ConfigService,
      promptPay as unknown as PromptPayService,
      storage as unknown as StorageService,
      publicSites as unknown as WebsitePublicService,
    );
  });

  const charge = (amount = 3531) =>
    service.createPromptPayCharge({
      tenantId: 'tenant-1',
      shares: [{ bookingId: 'booking-1234', amount }],
      grandTotal: 3531,
      account: { promptpayId: '0812345678', accountName: 'Hotel' } as never,
    });

  it('creates the QR against the hotel account (not the platform env) and signs a token', async () => {
    const info = await charge();
    expect(promptPay.generateQRCode).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        invoiceId: 'inv-1',
        promptpayId: '0812345678',
        amount: 3531,
      }),
    );
    expect(info.token).toHaveLength(32);
    expect(info.accountName).toBe('Hotel');
    expect(info).toMatchObject({ amount: 3531, grandTotal: 3531, balanceDue: 0, isDeposit: false });
  });

  it('charges only the deposit and reports the balance due at the hotel', async () => {
    promptPay.generateQRCode.mockImplementationOnce((dto: { amount: number }) =>
      Promise.resolve({
        transactionRef: 'PPREF',
        qrCodeImage: 'data:',
        amount: dto.amount,
        expiresAt: new Date(),
        promptpayId: '0812345678',
      }),
    );
    const info = await charge(1059.3);
    expect(promptPay.generateQRCode).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1059.3 }),
    );
    expect(info).toMatchObject({
      amount: 1059.3,
      grandTotal: 3531,
      balanceDue: 2471.7,
      isDeposit: true,
    });
    // แถวที่รอตรวจต้องเก็บยอดมัดจำ ไม่งั้นการอนุมัติถือเป็นยอดเต็ม
    expect(prisma.payments.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { amount: 1059.3, tenant_id: 'tenant-1' },
    });
  });

  it('rejects a wrong token before touching the database', async () => {
    await expect(service.getStatus('mountain-view', 'PPREF', 'nope')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.promptPayTransaction.findFirst).not.toHaveBeenCalled();
  });

  it('scopes the transaction lookup to the site tenant', async () => {
    const { token } = await charge();
    const status = await service.getStatus('mountain-view', 'PPREF', token);
    expect(prisma.promptPayTransaction.findFirst).toHaveBeenCalledWith({
      where: { transactionRef: 'PPREF', tenantId: 'tenant-1' },
    });
    expect(status).toMatchObject({
      status: 'pending',
      slipUploaded: false,
      bookingStatus: 'pending',
    });
  });

  it('stores the slip on the pending qr payment and notifies staff', async () => {
    const { token } = await charge();
    await service.uploadSlip('mountain-view', 'PPREF', token, png);
    expect(prisma.payments.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { slip_url: '/uploads/payment-slips/x.png', amount: 3531, tenant_id: 'tenant-1' },
    });
    expect(publicSites.notifyStaff).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ refId: 'booking-1234' }),
    );
  });

  it('rejects non-image and oversized slips', async () => {
    const { token } = await charge();
    await expect(
      service.uploadSlip('mountain-view', 'PPREF', token, { ...png, mimetype: 'application/pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadSlip('mountain-view', 'PPREF', token, { ...png, size: 6 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('does not overwrite anything once the hotel has verified the payment', async () => {
    prisma.promptPayTransaction.findFirst.mockResolvedValue({ ...tx, status: 'verified' });
    const { token } = await charge();
    const status = await service.uploadSlip('mountain-view', 'PPREF', token, png);
    expect(status.status).toBe('verified');
    expect(storage.save).not.toHaveBeenCalled();
  });

  describe('จองหลายห้อง (QR ใบเดียว)', () => {
    const groupBookings = [
      {
        id: 'booking-1234',
        bookingNo: 'BK-1',
        bookingGroupId: 'grp-1',
        guestFirstName: 'A',
        guestLastName: 'B',
      },
      {
        id: 'booking-5678',
        bookingNo: 'BK-2',
        bookingGroupId: 'grp-1',
        guestFirstName: 'A',
        guestLastName: 'B',
      },
    ];
    const groupInvoices = [
      { id: 'inv-1', booking_id: 'booking-1234' },
      { id: 'inv-2', booking_id: 'booking-5678' },
    ];

    beforeEach(() => {
      prisma.invoices.findMany.mockResolvedValue(groupInvoices);
      prisma.booking.findFirst.mockResolvedValue({ ...groupBookings[0], status: 'pending' });
      prisma.booking.findMany.mockResolvedValue(groupBookings);
      prisma.payments.findFirst.mockImplementation(({ where }: { where: { invoice_id: string } }) =>
        Promise.resolve({
          id: `pay-${where.invoice_id}`,
          invoice_id: where.invoice_id,
          amount: where.invoice_id === 'inv-1' ? 600 : 400,
          slip_url: null,
        }),
      );
      promptPay.generateQRCode.mockImplementation((dto: { amount: number }) =>
        Promise.resolve({
          transactionRef: 'PPREF',
          qrCodeImage: 'data:',
          amount: dto.amount,
          expiresAt: new Date(),
          promptpayId: '0812345678',
        }),
      );
    });

    it('charges the summed amount once and stores each room share on its own invoice', async () => {
      const info = await service.createPromptPayCharge({
        tenantId: 'tenant-1',
        shares: [
          { bookingId: 'booking-1234', amount: 600 },
          { bookingId: 'booking-5678', amount: 400 },
        ],
        grandTotal: 2000,
        account: { promptpayId: '0812345678', accountName: 'Hotel' } as never,
      });
      expect(promptPay.generateQRCode).toHaveBeenCalledTimes(1);
      expect(promptPay.generateQRCode).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'booking-1234', invoiceId: 'inv-1', amount: 1000 }),
      );
      expect(prisma.payments.update).toHaveBeenCalledWith({
        where: { id: 'pay-inv-1' },
        data: { amount: 600, tenant_id: 'tenant-1' },
      });
      expect(prisma.payments.update).toHaveBeenCalledWith({
        where: { id: 'pay-inv-2' },
        data: { amount: 400, tenant_id: 'tenant-1' },
      });
      expect(info).toMatchObject({
        amount: 1000,
        grandTotal: 2000,
        balanceDue: 1000,
        isDeposit: true,
      });
    });

    it('attaches one slip to every room without overwriting the per-room shares', async () => {
      prisma.promptPayTransaction.findFirst.mockResolvedValue({ ...tx, amount: 1000 });
      const { token } = await charge();
      prisma.payments.update.mockClear();
      await service.uploadSlip('mountain-view', 'PPREF', token, png);
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1', bookingGroupId: 'grp-1' } }),
      );
      expect(prisma.payments.update).toHaveBeenCalledTimes(2);
      expect(prisma.payments.update).toHaveBeenCalledWith({
        where: { id: 'pay-inv-2' },
        data: { slip_url: '/uploads/payment-slips/x.png', tenant_id: 'tenant-1' },
      });
      expect(publicSites.notifyStaff).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({
          message: expect.stringContaining('2 ห้อง: #BK-1 ฿600, #BK-2 ฿400'),
        }),
      );
    });
  });
});
