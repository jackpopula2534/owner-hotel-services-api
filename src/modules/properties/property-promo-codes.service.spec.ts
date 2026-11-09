import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PropertyPromoCodesService } from './property-promo-codes.service';

const row = {
  id: 'pc-1',
  tenantId: 't-1',
  propertyId: 'p-1',
  code: 'SUMMER10',
  description: null,
  discountType: 'percentage',
  discountValue: new Prisma.Decimal(10),
  maxDiscount: null,
  minNights: 1,
  minAmount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  isActive: true,
  parentId: null,
  issuedToGuestId: null,
  campaignId: null,
  campaignDeliveryId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PropertyPromoCodesService', () => {
  let prisma: {
    property: { findFirst: jest.Mock };
    propertyPromoCode: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    booking: { groupBy: jest.Mock };
    guest: { findMany: jest.Mock };
  };
  let service: PropertyPromoCodesService;

  beforeEach(() => {
    prisma = {
      property: { findFirst: jest.fn().mockResolvedValue({ id: 'p-1' }) },
      propertyPromoCode: {
        findFirst: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([row]),
        create: jest.fn().mockResolvedValue(row),
      },
      booking: { groupBy: jest.fn().mockResolvedValue([]) },
      guest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new PropertyPromoCodesService(prisma as unknown as PrismaService);
  });

  it('looks the code up case-insensitively within the property tenant', async () => {
    const rule = await service.findRedeemable('p-1', 't-1', ' summer10 ');
    expect(prisma.propertyPromoCode.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't-1', propertyId: 'p-1', code: 'SUMMER10', isActive: true },
    });
    expect(rule).toMatchObject({ id: 'pc-1', discountType: 'percentage', discountValue: 10 });
  });

  it('rejects unknown, expired and not-yet-valid codes', async () => {
    prisma.propertyPromoCode.findFirst.mockResolvedValueOnce(null);
    await expect(service.findRedeemable('p-1', 't-1', 'NOPE')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
      ...row,
      validUntil: new Date('2020-01-01T00:00:00.000Z'),
    });
    await expect(service.findRedeemable('p-1', 't-1', 'SUMMER10')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
      ...row,
      validFrom: new Date('2999-01-01T00:00:00.000Z'),
    });
    await expect(service.findRedeemable('p-1', 't-1', 'SUMMER10')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('counts non-cancelled bookings against the usage limit', async () => {
    prisma.propertyPromoCode.findFirst.mockResolvedValue({ ...row, usageLimit: 2 });
    prisma.booking.groupBy.mockResolvedValue([{ promoCodeId: 'pc-1', _count: { _all: 2 } }]);
    await expect(service.findRedeemable('p-1', 't-1', 'SUMMER10')).rejects.toThrow('ครบจำนวน');
    expect(prisma.booking.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't-1', promoCodeId: { in: ['pc-1'] }, status: { notIn: ['cancelled'] } },
      }),
    );
  });

  it('rejects a percentage above 100 and maps duplicate codes to 409', async () => {
    await expect(
      service.create('p-1', 't-1', {
        code: 'X100',
        discountType: 'percentage',
        discountValue: 150,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.propertyPromoCode.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      service.create('p-1', 't-1', { code: 'SUMMER10', discountType: 'fixed', discountValue: 200 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists codes with their usage counts', async () => {
    prisma.booking.groupBy.mockResolvedValue([{ promoCodeId: 'pc-1', _count: { _all: 3 } }]);
    const [view] = await service.list('p-1', 't-1');
    expect(view).toMatchObject({ code: 'SUMMER10', usedCount: 3, discountValue: 10 });
  });

  it('hides campaign-issued personal codes from the staff list', async () => {
    await service.list('p-1', 't-1');
    expect(prisma.propertyPromoCode.findMany.mock.calls[0][0].where).toEqual({
      propertyId: 'p-1',
      tenantId: 't-1',
      parentId: null,
    });
  });

  it('rejects a personal code once its template code is switched off', async () => {
    prisma.propertyPromoCode.findFirst
      .mockResolvedValueOnce({
        ...row,
        id: 'child',
        code: 'R-ABC123',
        parentId: 'pc-1',
        usageLimit: 1,
      })
      .mockResolvedValueOnce({ isActive: false });
    await expect(service.findRedeemable('p-1', 't-1', 'R-ABC123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.propertyPromoCode.findFirst.mock.calls[1][0].where).toEqual({
      id: 'pc-1',
      tenantId: 't-1',
    });
  });

  it('resolves only usable template codes for website offers', async () => {
    prisma.propertyPromoCode.findMany.mockResolvedValue([
      row,
      { ...row, id: 'pc-full', code: 'FULL', usageLimit: 1 },
      { ...row, id: 'pc-old', code: 'OLD', validUntil: new Date('2020-01-01T00:00:00Z') },
    ]);
    prisma.booking.groupBy.mockResolvedValue([{ promoCodeId: 'pc-full', _count: { _all: 1 } }]);
    const map = await service.resolveOfferCodes('p-1', 't-1', [
      'pc-1',
      'pc-full',
      'pc-old',
      'pc-1',
    ]);
    expect([...map]).toEqual([['pc-1', 'SUMMER10']]);
    expect(prisma.propertyPromoCode.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: 't-1',
      propertyId: 'p-1',
      parentId: null,
      isActive: true,
    });
  });

  describe('personal (campaign-issued) codes', () => {
    const personal = {
      ...row,
      id: 'child',
      code: 'RABC1234',
      parentId: 'pc-1',
      issuedToGuestId: 'g-owner',
    };
    beforeEach(() => {
      prisma.propertyPromoCode.findFirst.mockImplementation(async ({ where }) =>
        where.code ? personal : { isActive: true },
      );
    });

    it('lets the price quote through (no guest yet) but checks the owner on booking', async () => {
      await expect(service.findRedeemable('p-1', 't-1', 'RABC1234')).resolves.toMatchObject({
        id: 'child',
      });
      await expect(
        service.findRedeemable('p-1', 't-1', 'RABC1234', 'g-owner'),
      ).resolves.toMatchObject({
        id: 'child',
      });
      expect(prisma.guest.findMany).not.toHaveBeenCalled();
    });

    it('accepts a different guest row with the same email or phone', async () => {
      prisma.guest.findMany.mockResolvedValue([
        { id: 'g-owner', email: 'Ann@Mail.com', phone: '081-234-5678' },
        { id: 'g-new', email: ' ann@mail.com', phone: null },
      ]);
      await expect(
        service.findRedeemable('p-1', 't-1', 'RABC1234', 'g-new'),
      ).resolves.toMatchObject({
        id: 'child',
      });
      expect(prisma.guest.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't-1',
        id: { in: ['g-owner', 'g-new'] },
      });
    });

    it('rejects someone else using the code', async () => {
      prisma.guest.findMany.mockResolvedValue([
        { id: 'g-owner', email: 'ann@mail.com', phone: '0812345678' },
        { id: 'g-other', email: 'bob@mail.com', phone: '0899999999' },
      ]);
      await expect(
        service.findRedeemable('p-1', 't-1', 'RABC1234', 'g-other'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
