import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('bookings')
@ApiBearerAuth('JWT-auth')
@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all bookings' })
  async findAll(@Query() query: any) {
    return this.bookingsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get booking by ID' })
  async findOne(@Param('id') id: string) {
    return this.bookingsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new booking' })
  async create(@Body() createBookingDto: any) {
    return this.bookingsService.create(createBookingDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update booking' })
  async update(@Param('id') id: string, @Body() updateBookingDto: any) {
    return this.bookingsService.update(id, updateBookingDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel booking' })
  async remove(@Param('id') id: string) {
    return this.bookingsService.remove(id);
  }
}

