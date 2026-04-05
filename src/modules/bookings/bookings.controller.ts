import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BookingsService } from './bookings.service';
import { GuestFolioService } from './guest-folio.service';
import { AddFolioChargeDto } from './dto/add-folio-charge.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { WalkInDto } from './dto/walk-in.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('bookings')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'bookings', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly folioService: GuestFolioService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all bookings' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.findAll(query, user?.tenantId);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Create a new booking' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async create(
    @Body() createBookingDto: CreateBookingDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.bookingsService.create(createBookingDto, user?.tenantId);
  }

  @Get(':id/checkout-summary')
  @ApiOperation({ summary: 'Get checkout summary with charges and payment status' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async getCheckoutSummary(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.getCheckoutSummary(id, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.findOne(id, user?.tenantId);
  }

  @Put(':id')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Update booking' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async update(
    @Param('id') id: string,
    @Body() updateBookingDto: any,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.bookingsService.update(id, updateBookingDto, user?.tenantId);
  }

  @Post(':id/checkin')
  @ApiOperation({ summary: 'Check-in booking' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  async checkIn(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.checkIn(id, user?.tenantId);
  }

  @Post('walk-in')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  @ApiOperation({ summary: 'Walk-in guest — create booking + check-in in one step' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async walkIn(
    @Body() walkInDto: WalkInDto,
    @CurrentUser() user: { tenantId?: string; defaultPropertyId?: string },
  ) {
    return this.bookingsService.walkIn(walkInDto, user.tenantId, user.defaultPropertyId);
  }

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Check-out booking' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  async checkOut(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.checkOut(id, user?.tenantId);
  }

  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({ summary: 'Cancel booking' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.remove(id, user?.tenantId);
  }

  @Get(':id/folio')
  @ApiOperation({ summary: 'Get guest folio (running tab of charges)' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff')
  async getFolio(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.folioService.getFolio(id, user?.tenantId);
  }

  @Post(':id/folio/charges')
  @ApiOperation({ summary: 'Add charge to guest folio' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff')
  async addFolioCharge(
    @Param('id') id: string,
    @Body() dto: AddFolioChargeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.folioService.addCharge(id, user?.tenantId, dto);
  }

  @Post(':id/folio/finalize')
  @ApiOperation({ summary: 'Finalize guest folio for checkout' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin')
  async finalizeFolio(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.folioService.finalizeFolio(id, user?.tenantId);
  }
}
