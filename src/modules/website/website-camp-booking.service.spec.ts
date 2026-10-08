import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WebsiteCampBookingService } from './website-camp-booking.service';
import { CreateCampBookingDto } from './dto/website-camp-booking.dto';

const site = {
  id: 'site-1',
  tenantId: 't1',
  propertyId: 'p1',
  campgroundId: 'cg1',
  slug: 'pine',
  status: 'PUBLISHED',
  publishedContent: null,
};

const zone = (over: Record<string, unknown> = {}) => ({
  id: 'z1',
  name: 'ลานหญ้า',
  basePrice: 500,
  weekendPrice: null,
  seasonalRates: null,
  pricingMode: 'per_night',
  hasElectricity: true,
  electricityFee: 100,
  maxGuests: 4,
  maxTents: 2,
  allowVehicle: false,
  allowPet: false,
  pitches: [{ id: 'pitch-a' }, { id: 'pitch-b' }],
  ...over,
});

function setup(opts: { account?: boolean; blocked?: string[]; zones?: unknown[] } = {}) {
  const prisma = {
    campZone: { findMany: jest.fn().mockResolvedValue(opts.zones ?? [zone()]) },
    campReservation: {
      findMany: jest.fn().mockResolvedValue((opts.blocked ?? []).map((pitchId) => ({ pitchId }))),
    },
    websiteInquiry: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]) }),
    ),
  };
  const publicSites = {
    findPublishedSite: jest.fn().mockResolvedValue(site),
    assertStayDates: jest.fn(),
    notifyStaff: jest.fn().mockResolvedValue(undefined),
  };
  const campPublic = {
    findCampground: jest
      .fn()
      .mockResolvedValue({ id: 'cg1', name: 'Pine', checkInTime: '13:00', checkOutTime: '11:00' }),
    listEquipment: jest
      .fn()
      .mockResolvedValue([{ id: 'eq-1', name: 'เต็นท์ 2 คน', pricePerUnit: 250 }]),
  };
  const entitlement = { isLive: jest.fn().mockResolvedValue(true) };
  const reservations = {
    create: jest.fn().mockImplementation((dto: { pitchId: string }) =>
      Promise.resolve({
        success: true,
        data: {
          id: 'res-1',
          reservationNo: 'cr-001',
          status: 'pending',
          totalPrice: 1450,
          pitchId: dto.pitchId,
        },
      }),
    ),
  };
  const account = opts.account
    ? { id: 'acc', promptpayId: '0812345678', accountName: 'Pine Camp' }
    : null;
  const payments = {
    findPromptPayAccount: jest.fn().mockResolvedValue(account),
    findDepositPolicy: jest.fn().mockResolvedValue({ type: 'full', value: 0 }),
    createCampPromptPayCharge: jest
      .fn()
      .mockResolvedValue({ method: 'PROMPTPAY', transactionRef: 'PP1', amount: 1450 }),
  };
  const svc = new WebsiteCampBookingService(
    prisma as never,
    publicSites as never,
    campPublic as never,
    entitlement as never,
    reservations as never,
    payments as never,
  );
  return { svc, prisma, publicSites, entitlement, reservations, payments };
}

const booking = (over: Partial<CreateCampBookingDto> = {}): CreateCampBookingDto => ({
  checkIn: '2099-01-10',
  checkOut: '2099-01-12',
  guests: 2,
  tents: 1,
  zoneKey: 'z1',
  firstName: 'Somchai',
  lastName: 'K',
  phone: '0812345678',
  consent: true,
  ...over,
});

describe('WebsiteCampBookingService.getAvailability', () => {
  it('counts free pitches and quotes lodging + electricity per night', async () => {
    const { svc } = setup({ blocked: ['pitch-a'] });
    const res = await svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-12',
    });
    expect(res.nights).toBe(2);
    expect(res.zones[0]).toMatchObject({ key: 'z1', available: 1, reason: null });
    expect(res.zones[0].quote).toMatchObject({ lodging: 1000, electricity: 200, grandTotal: 1200 });
    expect(res.payment.promptpay).toBe(false);
  });

  it('flags full zones and zone rules (capacity / vehicle / pet)', async () => {
    const full = setup({ blocked: ['pitch-a', 'pitch-b'] });
    const r1 = await full.svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
    });
    expect(r1.zones[0]).toMatchObject({ available: 0, reason: 'FULL' });

    const { svc } = setup();
    const many = await svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
      guests: 6,
    });
    expect(many.zones[0].reason).toBe('CAPACITY');
    const car = await svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
      vehicles: 1,
    });
    expect(car.zones[0].reason).toBe('RULES');
    const pet = await svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
      pet: true,
    });
    expect(pet.zones[0].reason).toBe('RULES');
  });

  it('per_person zones multiply lodging by guests', async () => {
    const { svc } = setup({ zones: [zone({ pricingMode: 'per_person', hasElectricity: false })] });
    const res = await svc.getAvailability('pine', {
      checkIn: '2099-01-10',
      checkOut: '2099-01-11',
      guests: 3,
    });
    expect(res.zones[0].quote).toMatchObject({ lodging: 1500, electricity: 0, grandTotal: 1500 });
  });

  it('only tenant-scoped queries — overlap check filters by site tenant', async () => {
    const { svc, prisma } = setup();
    await svc.getAvailability('pine', { checkIn: '2099-01-10', checkOut: '2099-01-11' });
    expect(prisma.campZone.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 't1',
      campgroundId: 'cg1',
    });
    expect(prisma.campReservation.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 't1',
      status: { in: ['pending', 'confirmed', 'checked_in'] },
    });
  });

  it('404 when the site is not a campground site or not live', async () => {
    const hotel = setup();
    hotel.publicSites.findPublishedSite.mockResolvedValue({ ...site, campgroundId: null });
    await expect(
      hotel.svc.getAvailability('pine', { checkIn: '2099-01-10', checkOut: '2099-01-11' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const lapsed = setup();
    lapsed.entitlement.isLive.mockResolvedValue(false);
    await expect(
      lapsed.svc.getAvailability('pine', { checkIn: '2099-01-10', checkOut: '2099-01-11' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WebsiteCampBookingService.createBooking', () => {
  it('books the first free pitch via ReservationsService with source WEBSITE', async () => {
    const { svc, reservations, prisma, publicSites } = setup({ blocked: ['pitch-a'] });
    const res = await svc.createBooking(
      'pine',
      booking({ equipment: [{ addonId: 'eq-1', qty: 2 }] }),
    );

    const [dto, tenantId, opts] = reservations.create.mock.calls[0];
    expect(dto).toMatchObject({
      campgroundId: 'cg1',
      zoneId: 'z1',
      pitchId: 'pitch-b',
      numGuests: 2,
      addons: [{ addonId: 'eq-1', qty: 2 }],
      checkIn: '2099-01-10T00:00:00.000Z',
    });
    expect(tenantId).toBe('t1');
    expect(opts).toEqual({ source: 'WEBSITE' });
    expect(res).toMatchObject({ reference: 'CR-001', status: 'pending', payment: null });
    expect(res.quote.grandTotal).toBe(1450);
    expect(res.equipment).toEqual([{ name: 'เต็นท์ 2 คน', qty: 2, unitPrice: 250, amount: 500 }]);
    expect(prisma.websiteInquiry.create).toHaveBeenCalled();
    expect(publicSites.notifyStaff).toHaveBeenCalledWith('t1', expect.any(Object));
  });

  it('409 when every pitch in the zone is taken', async () => {
    const { svc, reservations } = setup({ blocked: ['pitch-a', 'pitch-b'] });
    await expect(svc.createBooking('pine', booking())).rejects.toBeInstanceOf(ConflictException);
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('rejects zone rule violations, unknown equipment and the honeypot', async () => {
    const { svc, reservations } = setup();
    await expect(svc.createBooking('pine', booking({ pet: true }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.createBooking('pine', booking({ equipment: [{ addonId: 'other-camp', qty: 1 }] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createBooking('pine', booking({ website: 'spam' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(reservations.create).not.toHaveBeenCalled();
  });

  it('PROMPTPAY needs an account; with one it creates a camp QR for the saved total', async () => {
    const none = setup();
    await expect(
      none.svc.createBooking('pine', booking({ paymentMethod: 'PROMPTPAY' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { svc, payments } = setup({ account: true });
    const res = await svc.createBooking('pine', booking({ paymentMethod: 'PROMPTPAY' }));
    expect(payments.createCampPromptPayCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        reservationId: 'res-1',
        amount: 1450,
        grandTotal: 1450,
      }),
    );
    expect(res.payment).toMatchObject({ transactionRef: 'PP1' });
  });

  it('QR failure still returns the reservation', async () => {
    const { svc, payments } = setup({ account: true });
    payments.createCampPromptPayCharge.mockRejectedValue(new Error('boom'));
    const res = await svc.createBooking('pine', booking({ paymentMethod: 'PROMPTPAY' }));
    expect(res.reference).toBe('CR-001');
    expect(res.payment).toBeNull();
  });
});
