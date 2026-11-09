import { PrismaService } from '@/prisma/prisma.service';
import { GuestFolioService } from './guest-folio.service';

const baseBooking = {
  id: 'booking-1',
  tenantId: 'tenant-1',
  guestFirstName: 'A',
  guestLastName: 'B',
  checkIn: new Date('2026-10-10T00:00:00Z'),
  checkOut: new Date('2026-10-12T00:00:00Z'),
  room: { number: '101' },
  totalPrice: 3000,
  roomSubtotal: 3000,
  serviceChargeAmount: 300,
  vatAmount: 231,
  grandTotal: 3531,
};

describe('GuestFolioService.getFolio', () => {
  let prisma: { booking: { findFirst: jest.Mock }; invoices: { findFirst: jest.Mock } };
  let service: GuestFolioService;

  beforeEach(() => {
    prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(baseBooking) },
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'inv-1',
          invoice_no: 'INV-1',
          status: 'draft',
          invoice_items: [
            { id: 'i-room', type: 'room_charge', description: 'room', amount: 3000 },
            { id: 'i-1', type: 'minibar', description: 'Coke', amount: 60.1 },
          ],
          payments: [
            { id: 'p-1', amount: 3531, method: 'qr', status: 'approved' },
            { id: 'p-2', amount: 500, method: 'cash', status: 'pending' },
          ],
        }),
      },
    };
    service = new GuestFolioService(prisma as unknown as PrismaService);
  });

  it('charges the room at grandTotal (service charge + VAT included) like the invoice/checkout', async () => {
    const folio = await service.getFolio('booking-1', 'tenant-1');
    expect(folio).toMatchObject({
      roomSubtotal: 3000,
      serviceChargeAmount: 300,
      vatAmount: 231,
      roomChargeAmount: 3531,
      additionalChargesTotal: 60.1,
      totalBalance: 3591.1,
      totalPaid: 3531,
      balanceDue: 60.1,
    });
  });

  it('treats totalPrice as the net room charge for legacy bookings without a tax breakdown', async () => {
    prisma.booking.findFirst.mockResolvedValue({
      ...baseBooking,
      roomSubtotal: null,
      serviceChargeAmount: null,
      vatAmount: null,
      grandTotal: null,
    });
    const folio = await service.getFolio('booking-1', 'tenant-1');
    expect(folio).toMatchObject({
      roomSubtotal: 3000,
      serviceChargeAmount: 0,
      vatAmount: 0,
      roomChargeAmount: 3000,
      totalBalance: 3060.1,
    });
  });
});
