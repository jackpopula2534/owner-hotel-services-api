---
name: backend-patterns
description: NestJS + Prisma backend patterns for hotel management SaaS API
---

# Backend Patterns — Owner Hotel Services API

## When to Activate

- สร้าง module/service/controller ใหม่
- เพิ่ม API endpoint
- ทำ database migration
- จัดการ error handling
- เพิ่ม caching
- ทำ background jobs

## NestJS Module Pattern

```typescript
// modules/bookings/bookings.module.ts
import { Module } from '@nestjs/common'
import { BookingsController } from './bookings.controller'
import { BookingsService } from './bookings.service'
import { PrismaModule } from '@/prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
```

## Controller Pattern

```typescript
// modules/bookings/bookings.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { BookingsService } from './bookings.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { BookingQueryDto } from './dto/booking-query.dto'

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'List all bookings' })
  @ApiResponse({ status: 200, description: 'Bookings retrieved successfully' })
  async findAll(@Query() query: BookingQueryDto) {
    return this.bookingsService.findAll(query)
  }

  @Post()
  @ApiOperation({ summary: 'Create a new booking' })
  @ApiResponse({ status: 201, description: 'Booking created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto)
  }
}
```

## Service Pattern

```typescript
// modules/bookings/bookings.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { CreateBookingDto } from './dto/create-booking.dto'

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: BookingQueryDto) {
    const { page = 1, limit = 20, status, propertyId } = query
    const skip = (page - 1) * limit

    const where = {
      ...(status && { status }),
      ...(propertyId && { propertyId }),
    }

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.booking.count({ where }),
    ])

    return {
      success: true,
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  }

  async create(dto: CreateBookingDto) {
    // Check room availability
    const overlapping = await this.prisma.booking.findFirst({
      where: {
        roomId: dto.roomId,
        status: { not: 'cancelled' },
        OR: [
          { checkIn: { lte: dto.checkOut }, checkOut: { gte: dto.checkIn } },
        ],
      },
    })

    if (overlapping) {
      throw new BadRequestException('Room is not available for selected dates')
    }

    const booking = await this.prisma.booking.create({ data: dto })
    this.logger.log(`Booking created: ${booking.id}`)
    return { success: true, data: booking }
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } })
    if (!booking) throw new NotFoundException(`Booking ${id} not found`)
    return { success: true, data: booking }
  }
}
```

## DTO Pattern

```typescript
// modules/bookings/dto/create-booking.dto.ts
import { IsString, IsDateString, IsNumber, IsUUID, Min, Max, IsOptional } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateBookingDto {
  @ApiProperty({ description: 'Room ID' })
  @IsUUID()
  roomId: string

  @ApiProperty({ description: 'Guest name' })
  @IsString()
  guestName: string

  @ApiProperty({ description: 'Check-in date' })
  @IsDateString()
  checkIn: string

  @ApiProperty({ description: 'Check-out date' })
  @IsDateString()
  checkOut: string

  @ApiProperty({ description: 'Number of guests', minimum: 1, maximum: 10 })
  @IsNumber()
  @Min(1)
  @Max(10)
  guests: number

  @ApiProperty({ description: 'Special requests', required: false })
  @IsOptional()
  @IsString()
  specialRequests?: string
}
```

## Error Handling Pattern

```typescript
// common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common'

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse()

    this.logger.error(`HTTP ${status}: ${exception.message}`)

    response.status(status).json({
      success: false,
      error: {
        code: typeof exceptionResponse === 'object' ? (exceptionResponse as any).error : 'ERROR',
        message: exception.message,
      },
    })
  }
}
```

## Prisma Transaction Pattern

```typescript
async transferBooking(bookingId: string, newRoomId: string) {
  return this.prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new NotFoundException('Booking not found')

    // Release old room
    await tx.room.update({ where: { id: booking.roomId }, data: { status: 'available' } })

    // Assign new room
    await tx.room.update({ where: { id: newRoomId }, data: { status: 'occupied' } })

    // Update booking
    return tx.booking.update({ where: { id: bookingId }, data: { roomId: newRoomId } })
  })
}
```

## Caching Pattern (Redis)

```typescript
import { Injectable, Inject, CACHE_MANAGER } from '@nestjs/common'
import { Cache } from 'cache-manager'

@Injectable()
export class RoomsService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly prisma: PrismaService,
  ) {}

  async getAvailableRooms(propertyId: string) {
    const cacheKey = `rooms:available:${propertyId}`
    const cached = await this.cacheManager.get(cacheKey)
    if (cached) return cached

    const rooms = await this.prisma.room.findMany({
      where: { propertyId, status: 'available' },
    })

    await this.cacheManager.set(cacheKey, rooms, 300) // 5 min TTL
    return rooms
  }
}
```

## Background Job Pattern (Bull)

```typescript
import { Processor, Process } from '@nestjs/bull'
import { Job } from 'bull'
import { Logger } from '@nestjs/common'

@Processor('notifications')
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name)

  @Process('send-email')
  async handleSendEmail(job: Job<{ to: string; subject: string; template: string }>) {
    this.logger.log(`Sending email to ${job.data.to}`)
    // Email sending logic
  }

  @Process('push-notification')
  async handlePushNotification(job: Job<{ userId: string; title: string; body: string }>) {
    this.logger.log(`Push notification to user ${job.data.userId}`)
    // Firebase push logic
  }
}
```
