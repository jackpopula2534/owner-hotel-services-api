import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    const { page = 1, limit = 10, rating, bookingId, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
    if (rating) where.rating = parseInt(rating);
    if (bookingId) where.bookingId = bookingId;
    if (search) {
      where.OR = [{ comment: { contains: search } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          booking: {
            include: {
              guest: true,
              room: true,
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const review = await this.prisma.review.findFirst({
      where,
      include: {
        booking: {
          include: {
            guest: true,
            room: true,
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundException(`Review with ID ${id} not found`);
    }

    return review;
  }

  async findByBookingId(bookingId: string, tenantId?: string) {
    const where: any = { bookingId };
    if (tenantId != null) where.tenantId = tenantId;

    const review = await this.prisma.review.findFirst({
      where,
      include: {
        booking: {
          include: {
            guest: true,
            room: true,
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundException(`Review for booking ${bookingId} not found`);
    }

    return review;
  }

  async create(createReviewDto: CreateReviewDto, tenantId?: string) {
    if (createReviewDto.bookingId) {
      const bookingWhere: any = { id: createReviewDto.bookingId };
      if (tenantId != null) bookingWhere.tenantId = tenantId;
      const booking = await this.prisma.booking.findFirst({
        where: bookingWhere,
      });

      if (!booking) {
        throw new NotFoundException(
          `Booking with ID ${createReviewDto.bookingId} not found`,
        );
      }

      const existingWhere: any = { bookingId: createReviewDto.bookingId };
      if (tenantId != null) existingWhere.tenantId = tenantId;
      const existingReview = await this.prisma.review.findFirst({
        where: existingWhere,
      });

      if (existingReview) {
        throw new BadRequestException(
          `Review for booking ${createReviewDto.bookingId} already exists`,
        );
      }
    }

    const data: any = { ...createReviewDto };
    if (tenantId != null) data.tenantId = tenantId;
    return this.prisma.review.create({
      data,
    });
  }

  async update(id: string, updateReviewDto: UpdateReviewDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.review.update({
      where: { id },
      data: updateReviewDto,
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.review.delete({
      where: { id },
    });
  }

  async getStats(tenantId?: string) {
    const where: any = tenantId != null ? { tenantId } : {};
    const [total, averageRating, ratingDistribution] = await Promise.all([
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({
        where,
        _avg: { rating: true },
      }),
      this.prisma.review.groupBy({
        where,
        by: ['rating'],
        _count: { rating: true },
      }),
    ]);

    const distribution = ratingDistribution.reduce((acc, item) => {
      acc[item.rating] = item._count.rating;
      return acc;
    }, {} as Record<number, number>);

    return {
      total,
      averageRating: averageRating._avg.rating || 0,
      ratingDistribution: {
        1: distribution[1] || 0,
        2: distribution[2] || 0,
        3: distribution[3] || 0,
        4: distribution[4] || 0,
        5: distribution[5] || 0,
      },
    };
  }

  async generateQRCode(bookingId: string, tenantId?: string) {
    const bookingWhere: any = { id: bookingId };
    if (tenantId != null) bookingWhere.tenantId = tenantId;
    const booking = await this.prisma.booking.findFirst({
      where: bookingWhere,
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const existingWhere: any = { bookingId };
    if (tenantId != null) existingWhere.tenantId = tenantId;
    const existingReview = await this.prisma.review.findFirst({
      where: existingWhere,
    });

    if (existingReview) {
      throw new BadRequestException(
        `Review for booking ${bookingId} already exists`,
      );
    }

    const reviewCode = `REV-${bookingId.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    return {
      code: reviewCode,
      bookingId,
      qrCodeUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/review/${reviewCode}`,
      message: 'QR code generated successfully',
    };
  }

  async findByQRCode(code: string, tenantId?: string) {
    const parts = code.split('-');
    if (parts.length < 2) {
      throw new BadRequestException('Invalid QR code format');
    }

    const where: any = {
      bookingId: {
        startsWith: parts[1],
      },
    };
    if (tenantId != null) where.tenantId = tenantId;

    const reviews = await this.prisma.review.findMany({
      where,
      include: {
        booking: {
          include: {
            guest: true,
            room: true,
          },
        },
      },
    });

    if (reviews.length === 0) {
      throw new NotFoundException(`Review with QR code ${code} not found`);
    }

    return reviews[0];
  }
}

