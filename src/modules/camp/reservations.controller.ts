import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import {
  CreateReservationDto,
  UpdateReservationDto,
} from './dto/reservation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];
const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff'];

@ApiTags('camp-reservations')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/reservations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get()
  @ApiOperation({ summary: 'List reservations' })
  @Roles(...READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string,
    @Query('status') status: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll({ campgroundId, status }, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reservation by id' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create reservation (prevents double-booking)' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update reservation' })
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReservationDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId);
  }

  @Post(':id/check-in')
  @ApiOperation({ summary: 'Check-in reservation' })
  @Roles(...WRITE_ROLES)
  checkIn(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.checkIn(id, user?.tenantId);
  }

  @Post(':id/check-out')
  @ApiOperation({ summary: 'Check-out reservation' })
  @Roles(...WRITE_ROLES)
  checkOut(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.checkOut(id, user?.tenantId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel reservation' })
  @Roles(...WRITE_ROLES)
  cancel(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.cancel(id, user?.tenantId);
  }
}
