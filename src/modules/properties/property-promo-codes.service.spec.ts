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
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PropertyPromoCodesService', () => {
  let prisma: {
    property: { findFirst: jest.Mock };
    propertyPromoCode: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    booking: { groupBy: jest.Mock };
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
});
