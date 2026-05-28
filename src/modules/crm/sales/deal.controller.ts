import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DealService } from './deal.service';
import { CreateDealDto, MoveStageDto, QueryDealsDto, UpdateDealDto } from './dto/deal.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/deals')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/deals' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DealController {
  constructor(private readonly deals: DealService) {}

  @Get()
  @ApiOperation({ summary: 'List deals (Kanban friendly — orderBy stage)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async findAll(@Query() query: QueryDealsDto, @CurrentUser() user: { tenantId?: string }) {
    return this.deals.findAll(query, user?.tenantId);
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Pipeline forecast — value + weighted + win rate' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async forecast(@CurrentUser() user: { tenantId: string }) {
    return this.deals.forecast(user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deal by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.deals.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a deal directly (without converting a lead)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async create(@Body() dto: CreateDealDto, @CurrentUser() user: { tenantId?: string }) {
    return this.deals.create(dto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a non-terminal deal' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDealDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.deals.update(id, dto, user?.tenantId);
  }

  @Patch(':id/move-stage')
  @ApiOperation({ summary: 'Move deal to next stage (forward-only, lost requires reason)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async moveStage(
    @Param('id') id: string,
    @Body() dto: MoveStageDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.deals.moveStage(id, dto, user?.tenantId);
  }

  @Post(':id/bookings')
  @ApiOperation({ summary: 'Attach generated booking IDs to a won deal' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async attachBookings(
    @Param('id') id: string,
    @Body() body: { bookingIds: string[] },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.deals.attachBookings(id, body.bookingIds ?? [], user.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete deal (won deals cannot be deleted)' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.deals.remove(id, user.tenantId);
  }
}
