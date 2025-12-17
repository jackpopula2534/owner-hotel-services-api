import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, rating, bookingId, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (rating) where.rating = parseInt(rating);
    if (bookingId) where.bookingId = bookingId;
    if (search) {
      where.OR = [
        { comment: { contains: search } },
      ];
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

  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
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

  async findByBookingId(bookingId: string) {
    const review = await this.prisma.review.findUnique({
      where: { bookingId },
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

  async create(createReviewDto: CreateReviewDto) {
    // If bookingId is provided, check if booking exists and if review already exists
    if (createReviewDto.bookingId) {
      const booking = await this.prisma.booking.findUnique({
        where: { id: createReviewDto.bookingId },
      });

      if (!booking) {
        throw new NotFoundException(
          `Booking with ID ${createReviewDto.bookingId} not found`,
        );
      }

      const existingReview = await this.prisma.review.findUnique({
        where: { bookingId: createReviewDto.bookingId },
      });

      if (existingReview) {
        throw new BadRequestException(
          `Review for booking ${createReviewDto.bookingId} already exists`,
        );
      }
    }

    return this.prisma.review.create({
      data: createReviewDto,
    });
  }

  async update(id: string, updateReviewDto: UpdateReviewDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.review.update({
      where: { id },
      data: updateReviewDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.review.delete({
      where: { id },
    });
  }

  async getStats() {
    const [total, averageRating, ratingDistribution] = await Promise.all([
      this.prisma.review.count(),
      this.prisma.review.aggregate({
        _avg: { rating: true },
      }),
      this.prisma.review.groupBy({
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

  async generateQRCode(bookingId: string) {
    // Check if booking exists
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${bookingId} not found`);
    }

    // Check if review already exists
    const existingReview = await this.prisma.review.findUnique({
      where: { bookingId },
    });

    if (existingReview) {
      throw new BadRequestException(
        `Review for booking ${bookingId} already exists`,
      );
    }

    // Generate a unique code for the review
    // In production, you might want to use a more secure method
    const reviewCode = `REV-${bookingId.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    return {
      code: reviewCode,
      bookingId,
      qrCodeUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/review/${reviewCode}`,
      message: 'QR code generated successfully',
    };
  }

  async findByQRCode(code: string) {
    // Extract booking ID from code (format: REV-{bookingId}-{timestamp})
    const parts = code.split('-');
    if (parts.length < 2) {
      throw new BadRequestException('Invalid QR code format');
    }

    // Try to find review by booking ID pattern
    // This is a simplified implementation - you might want to store QR codes in database
    const reviews = await this.prisma.review.findMany({
      where: {
        bookingId: {
          startsWith: parts[1],
        },
      },
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

