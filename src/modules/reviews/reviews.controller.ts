import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('reviews')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'reviews', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all reviews' })
  @ApiResponse({ status: 200, description: 'List of reviews' })
  @Roles('admin', 'manager')
  async findAll(@Query() query: any) {
    return this.reviewsService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get review statistics' })
  @ApiResponse({ status: 200, description: 'Review statistics' })
  @Roles('admin', 'manager')
  async getStats() {
    return this.reviewsService.getStats();
  }

  @Get('qr/:code')
  @ApiOperation({ summary: 'Get review by QR code' })
  @ApiResponse({ status: 200, description: 'Review details' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @Roles('admin', 'manager')
  async findByQRCode(@Param('code') code: string) {
    return this.reviewsService.findByQRCode(code);
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'Get review by booking ID' })
  @ApiResponse({ status: 200, description: 'Review details' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @Roles('admin', 'manager')
  async findByBookingId(@Param('bookingId') bookingId: string) {
    return this.reviewsService.findByBookingId(bookingId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get review by ID' })
  @ApiResponse({ status: 200, description: 'Review details' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  @Roles('admin', 'manager')
  async findOne(@Param('id') id: string) {
    return this.reviewsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new review' })
  @ApiResponse({ status: 201, description: 'Review created successfully' })
  @Roles('admin', 'manager')
  async create(@Body() createReviewDto: CreateReviewDto) {
    return this.reviewsService.create(createReviewDto);
  }

  @Post('qr/generate')
  @ApiOperation({ summary: 'Generate QR code for review' })
  @ApiResponse({ status: 201, description: 'QR code generated successfully' })
  @Roles('admin', 'manager')
  async generateQRCode(@Body('bookingId') bookingId: string) {
    return this.reviewsService.generateQRCode(bookingId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update review' })
  @ApiResponse({ status: 200, description: 'Review updated successfully' })
  @Roles('admin', 'manager')
  async update(
    @Param('id') id: string,
    @Body() updateReviewDto: UpdateReviewDto,
  ) {
    return this.reviewsService.update(id, updateReviewDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete review' })
  @ApiResponse({ status: 200, description: 'Review deleted successfully' })
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return this.reviewsService.remove(id);
  }
}

