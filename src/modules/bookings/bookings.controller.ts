import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('bookings')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'bookings', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all bookings' })
  @Roles('admin', 'manager')
  async findAll(@Query() query: any) {
    return this.bookingsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by ID' })
  @Roles('admin', 'manager')
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new booking' })
  @Roles('admin', 'manager')
  async create(@Body() createBookingDto: any) {
    return this.bookingsService.create(createBookingDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update booking' })
  @Roles('admin', 'manager')
  async update(@Param('id') id: string, @Body() updateBookingDto: any) {
    return this.bookingsService.update(id, updateBookingDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel booking' })
  @Roles('admin', 'manager')
  async remove(@Param('id') id: string) {
    return this.bookingsService.remove(id);
  }
}

