import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { rating, bookingId, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (rating) where.rating = parseInt(rating);
    if (bookingId) where.bookingId = bookingId;
    if (search) {
      where.OR = [{ comment: { contains: search } }];
    }

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
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
      page,
      limit,
    };
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { bookingId, tenantId };

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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (createReviewDto.bookingId) {
      const bookingWhere: any = { id: createReviewDto.bookingId, tenantId };
      const booking = await this.prisma.booking.findFirst({
        where: bookingWhere,
      });

      if (!booking) {
        throw new NotFoundException(`Booking with ID ${createReviewDto.bookingId} not found`);
      }

      const existingWhere: any = { bookingId: createReviewDto.bookingId, tenantId };
      const existingReview = await this.prisma.review.findFirst({
        where: existingWhere,
      });

      if (existingReview) {
        throw new BadRequestException(
          `Review for booking ${createReviewDto.bookingId} already exists`,
        );
      }
    }

    const data: any = { ...createReviewDto, tenantId };
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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { tenantId };
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

    const distribution = ratingDistribution.reduce(
      (acc, item) => {
        acc[item.rating] = item._count.rating;
        return acc;
      },
      {} as Record<number, number>,
    );

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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const bookingWhere: any = { id: bookingId, tenantId };
    const booking = await this.prisma.booking.findFirst({
      where: bookingWhere,
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    const existingWhere: any = { bookingId, tenantId };
    const existingReview = await this.prisma.review.findFirst({
      where: existingWhere,
    });

    if (existingReview) {
      throw new BadRequestException(`Review for booking ${bookingId} already exists`);
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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const parts = code.split('-');
    if (parts.length < 2) {
      throw new BadRequestException('Invalid QR code format');
    }

    const where: any = {
      bookingId: {
        startsWith: parts[1],
      },
      tenantId,
    };

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
