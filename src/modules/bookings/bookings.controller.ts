import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('bookings')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'bookings', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all bookings' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new booking' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async create(
    @Body() createBookingDto: any,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.bookingsService.create(createBookingDto, user?.tenantId);
  }

  @Put(':id')
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

  @Post(':id/checkout')
  @ApiOperation({ summary: 'Check-out booking' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  async checkOut(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.checkOut(id, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel booking' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.bookingsService.remove(id, user?.tenantId);
  }
}

