import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ReservationService } from './reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('restaurant / reservations')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@Controller({ path: 'restaurants/:restaurantId/reservations', version: '1' })
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all reservations (with date/status filter)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'date', required: false, example: '2026-04-15' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist', 'staff')
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: { date?: string; status?: string; page?: number; limit?: number },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.findAll(restaurantId, query, user.tenantId);
  }

  @Get(':reservationId')
  @ApiOperation({ summary: 'Get reservation by ID' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'reservationId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist', 'staff')
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('reservationId') reservationId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.findOne(restaurantId, reservationId, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create reservation' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist', 'staff')
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.create(restaurantId, dto, user.tenantId);
  }

  @Patch(':reservationId')
  @ApiOperation({ summary: 'Update reservation' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'reservationId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist')
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('reservationId') reservationId: string,
    @Body() dto: UpdateReservationDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.update(restaurantId, reservationId, dto, user.tenantId);
  }

  @Patch(':reservationId/no-show')
  @ApiOperation({ summary: 'Mark reservation as no-show' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'reservationId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist')
  async markAsNoShow(
    @Param('restaurantId') restaurantId: string,
    @Param('reservationId') reservationId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.markAsNoShow(restaurantId, reservationId, user.tenantId);
  }

  @Delete(':reservationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete reservation' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'reservationId' })
  @ApiResponse({ status: 204 })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async remove(
    @Param('restaurantId') restaurantId: string,
    @Param('reservationId') reservationId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.reservationService.remove(restaurantId, reservationId, user.tenantId);
  }
}
