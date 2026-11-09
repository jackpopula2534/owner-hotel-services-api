import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { EmailEventsService } from '../../email/email-events.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { mockAuditLogService, mockEventEmitter } from '../../common/test/mock-providers';
import { withPrismaFallback } from '../../common/test/mock-prisma';
import { RevenuePostingService } from '../revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '../revenue/__tests__/revenue-posting.stub';
import { BookingsService } from './bookings.service';

describe('BookingsService — extra bed pricing (quoteStay)', () => {
  let service: BookingsService;

  const room = {
    price: 2500,
    maxOccupancy: 2,
    extraBedAllowed: true,
    extraBedLimit: 1,
    extraBedPrice: 600,
    childNoExtraCharge: false,
  };
  const property = {
    serviceChargeEnabled: true,
    serviceChargePercent: 10,
    vatEnabled: true,
    vatPercent: 7,
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: withPrismaFallback({}) },
        { provide: EventEmitter2, useValue: mockEventEmitter() },
        { provide: AuditLogService, useValue: mockAuditLogService() },
        { provide: EmailEventsService, useValue: {} },
        { provide: HousekeepingService, useValue: {} },
        { provide: InvoicesService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  const quote = (adults: number, children: number, r: object = room) =>
    service.quoteStay(r, property, '2026-12-01', '2026-12-03', [], { adults, children });

  it('charges nothing extra when guests fit the standard beds', () => {
    const q = quote(2, 0);
    expect(q.extraBeds).toBeUndefined();
    expect(q.roomSubtotal).toBe(5000);
    expect(q.grandTotal).toBe(5885);
  });

  it('adds extraBedPrice per extra guest per night before service charge and VAT', () => {
    const q = quote(2, 1);
    expect(q.extraBeds).toEqual({ guests: 1, ratePerNight: 600, nights: 2, amount: 1200 });
    expect(q.roomSubtotal).toBe(6200);
    expect(q.serviceChargeAmount).toBe(620);
    expect(q.vatAmount).toBe(477.4);
    expect(q.grandTotal).toBe(7297.4);
  });

  it('does not charge an extra bed for children who stay free', () => {
    const q = quote(2, 1, { ...room, childNoExtraCharge: true });
    expect(q.extraBeds).toBeUndefined();
    expect(q.roomSubtotal).toBe(5000);
  });
});
