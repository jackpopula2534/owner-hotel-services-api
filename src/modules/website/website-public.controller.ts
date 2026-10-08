import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SiteFallbackPayload, SitePayload, WebsitePublicService } from './website-public.service';
import { CreateWebsiteInquiryDto } from './dto/create-website-inquiry.dto';
import { CreateWebsiteBookingDto, WebsiteAvailabilityQueryDto } from './dto/website-booking.dto';
import {
  WebsiteAvailability,
  WebsiteBookingResult,
  WebsiteBookingService,
} from './website-booking.service';
import { CampAvailabilityQueryDto, CreateCampBookingDto } from './dto/website-camp-booking.dto';
import {
  CampAvailability,
  CampBookingResult,
  WebsiteCampBookingService,
} from './website-camp-booking.service';
import {
  SLIP_MAX_BYTES,
  WebsitePaymentService,
  WebsitePaymentStatus,
} from './website-payment.service';

interface SlipFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * หน้าเว็บสาธารณะของโรงแรม (<slug>.staysync.io) — ไม่ต้อง login
 * throttler v5: ttl เป็นมิลลิวินาที
 */
@ApiTags('public/sites')
@Controller({ path: 'public/sites' })
@Public()
export class WebsitePublicController {
  constructor(
    private readonly publicService: WebsitePublicService,
    private readonly bookingService: WebsiteBookingService,
    private readonly paymentService: WebsitePaymentService,
    private readonly campBookingService: WebsiteCampBookingService,
  ) {}

  @Get(':slug')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Published site payload for rendering' })
  @ApiResponse({
    status: 200,
    description: '{ available: true, ... } or { available: false, fallback }',
  })
  @ApiResponse({ status: 404, description: 'No published site for this slug' })
  getSite(@Param('slug') slug: string): Promise<SitePayload | SiteFallbackPayload> {
    return this.publicService.getPublishedSite(slug);
  }

  @Post(':slug/inquiries')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Contact form / booking request from the hotel website' })
  @ApiResponse({ status: 201, description: '{ received: true }' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  createInquiry(
    @Param('slug') slug: string,
    @Body() dto: CreateWebsiteInquiryDto,
  ): Promise<{ received: true }> {
    return this.publicService.createInquiry(slug, dto);
  }

  @Get(':slug/availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Available room types + server-side price quote for a stay' })
  @ApiResponse({ status: 200, description: 'WebsiteAvailability' })
  @ApiResponse({ status: 400, description: 'Invalid dates' })
  getAvailability(
    @Param('slug') slug: string,
    @Query() query: WebsiteAvailabilityQueryDto,
  ): Promise<WebsiteAvailability> {
    return this.bookingService.getAvailability(slug, query);
  }

  @Post(':slug/bookings')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Guest self-booking from the hotel website (status pending)' })
  @ApiResponse({ status: 201, description: 'WebsiteBookingResult' })
  @ApiResponse({ status: 409, description: 'Room type sold out for these dates' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  createBooking(
    @Param('slug') slug: string,
    @Body() dto: CreateWebsiteBookingDto,
    @Req() req: Request,
  ): Promise<WebsiteBookingResult> {
    return this.bookingService.createBooking(slug, dto, req.ip ?? null);
  }

  @Get(':slug/camp-availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Campground website: free pitches per zone + price quote' })
  @ApiResponse({ status: 200, description: 'CampAvailability' })
  @ApiResponse({ status: 400, description: 'Invalid dates' })
  getCampAvailability(
    @Param('slug') slug: string,
    @Query() query: CampAvailabilityQueryDto,
  ): Promise<CampAvailability> {
    return this.campBookingService.getAvailability(slug, query);
  }

  @Post(':slug/camp-bookings')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Guest self-booking of a camping pitch (status pending)' })
  @ApiResponse({ status: 201, description: 'CampBookingResult' })
  @ApiResponse({ status: 409, description: 'Zone sold out for these dates' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  createCampBooking(
    @Param('slug') slug: string,
    @Body() dto: CreateCampBookingDto,
  ): Promise<CampBookingResult> {
    return this.campBookingService.createBooking(slug, dto);
  }

  /** แขกไม่มี session — สิทธิ์ = token (HMAC ของ ref) ที่ได้ตอนจอง */
  @Get(':slug/payments/:ref')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'PromptPay payment status of a website booking (token-gated)' })
  @ApiResponse({ status: 200, description: 'WebsitePaymentStatus' })
  @ApiResponse({ status: 403, description: 'Invalid token' })
  getPaymentStatus(
    @Param('slug') slug: string,
    @Param('ref') ref: string,
    @Query('token') token: string,
  ): Promise<WebsitePaymentStatus> {
    return this.paymentService.getStatus(slug, ref, token);
  }

  @Post(':slug/payments/:ref/slip')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Guest uploads a PromptPay transfer slip for hotel verification' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'WebsitePaymentStatus' })
  @ApiResponse({ status: 403, description: 'Invalid token' })
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: SLIP_MAX_BYTES } }),
  )
  uploadSlip(
    @Param('slug') slug: string,
    @Param('ref') ref: string,
    @Query('token') token: string,
    @UploadedFile() file: SlipFile | undefined,
  ): Promise<WebsitePaymentStatus> {
    return this.paymentService.uploadSlip(slug, ref, token, file);
  }
}
