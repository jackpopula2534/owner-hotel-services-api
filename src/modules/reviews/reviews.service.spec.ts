import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: jest.Mocked<PrismaService>;

  const createMockPrisma = (): jest.Mocked<PrismaService> =>
    ({
      review: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
      booking: {
        findUnique: jest.fn(),
      },
    } as any);

  beforeEach(async () => {
    const mockPrisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated reviews', async () => {
      (prisma.review.findMany as jest.Mock).mockResolvedValue([{ id: '1' }]);
      (prisma.review.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toEqual({
        data: [{ id: '1' }],
        total: 1,
        page: 1,
        limit: 10,
      });
    });
  });

  describe('findOne', () => {
    it('should return a review when found', async () => {
      (prisma.review.findUnique as jest.Mock).mockResolvedValue({ id: '1' });

      const result = await service.findOne('1');

      expect(result).toEqual({ id: '1' });
    });

    it('should throw NotFoundException when review not found', async () => {
      (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByBookingId', () => {
    it('should return review for booking', async () => {
      (prisma.review.findUnique as jest.Mock).mockResolvedValue({ id: '1' });

      const result = await service.findByBookingId('booking-1');

      expect(result).toEqual({ id: '1' });
    });

    it('should throw NotFoundException when no review for booking', async () => {
      (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findByBookingId('booking-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create review when booking exists and no existing review', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: 'booking-1',
      });
      (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.review.create as jest.Mock).mockResolvedValue({ id: '1' });

      const dto = {
        rating: 5,
        comment: 'Great',
        bookingId: 'booking-1',
      } as any;

      const result = await service.create(dto);

      expect(prisma.review.create).toHaveBeenCalled();
      expect(result).toEqual({ id: '1' });
    });

    it('should throw NotFoundException when booking not found', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create({
          rating: 5,
          comment: 'Great',
          bookingId: 'booking-1',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review already exists for booking', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: 'booking-1',
      });
      (prisma.review.findUnique as jest.Mock).mockResolvedValue({ id: '1' });

      await expect(
        service.create({
          rating: 5,
          comment: 'Great',
          bookingId: 'booking-1',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update review successfully', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ id: '1' } as any);
      (prisma.review.update as jest.Mock).mockResolvedValue({
        id: '1',
        comment: 'Updated',
      });

      const result = await service.update('1', { comment: 'Updated' } as any);

      expect(result).toEqual({ id: '1', comment: 'Updated' });
    });
  });

  describe('remove', () => {
    it('should delete review successfully', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ id: '1' } as any);
      (prisma.review.delete as jest.Mock).mockResolvedValue({ id: '1' });

      const result = await service.remove('1');

      expect(result).toEqual({ id: '1' });
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      (prisma.review.count as jest.Mock).mockResolvedValue(3);
      (prisma.review.aggregate as jest.Mock).mockResolvedValue({
        _avg: { rating: 4 },
      });
      (prisma.review.groupBy as jest.Mock).mockResolvedValue([
        { rating: 5, _count: { rating: 2 } },
        { rating: 3, _count: { rating: 1 } },
      ]);

      const result = await service.getStats();

      expect(result.total).toBe(3);
      expect(result.averageRating).toBe(4);
      expect(result.ratingDistribution[5]).toBe(2);
      expect(result.ratingDistribution[3]).toBe(1);
    });
  });

  describe('generateQRCode', () => {
    it('should generate QR code when booking exists and no review', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: 'booking-1',
      });
      (prisma.review.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.generateQRCode('booking-1');

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('qrCodeUrl');
    });

    it('should throw NotFoundException when booking not found', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.generateQRCode('booking-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when review already exists', async () => {
      (prisma.booking.findUnique as jest.Mock).mockResolvedValue({
        id: 'booking-1',
      });
      (prisma.review.findUnique as jest.Mock).mockResolvedValue({ id: '1' });

      await expect(service.generateQRCode('booking-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findByQRCode', () => {
    it('should throw BadRequestException for invalid format', async () => {
      await expect(service.findByQRCode('INVALID')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return first matching review', async () => {
      (prisma.review.findMany as jest.Mock).mockResolvedValue([
        { id: '1' },
      ]);

      const result = await service.findByQRCode('REV-BOOKING-XYZ');

      expect(result).toEqual({ id: '1' });
    });

    it('should throw NotFoundException when no reviews match', async () => {
      (prisma.review.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.findByQRCode('REV-BOOKING-XYZ'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});




