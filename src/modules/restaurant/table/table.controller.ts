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
import { TableService } from './table.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('restaurant / tables')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@Controller({ path: 'restaurants/:restaurantId/tables', version: '1' })
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Get()
  @ApiOperation({ summary: 'Get all tables' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'zone', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: { status?: string; zone?: string; isActive?: string },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.findAll(restaurantId, query, user.tenantId);
  }

  @Get('availability')
  @ApiOperation({ summary: 'Check table availability for a datetime + party size' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'date', required: true, example: '2026-04-15' })
  @ApiQuery({ name: 'startTime', required: true, example: '19:00' })
  @ApiQuery({ name: 'partySize', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'receptionist', 'staff')
  async checkAvailability(
    @Param('restaurantId') restaurantId: string,
    @Query() query: { date: string; startTime: string; partySize?: number },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.checkAvailability(restaurantId, query, user.tenantId);
  }

  @Get(':tableId')
  @ApiOperation({ summary: 'Get table by ID' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.findOne(restaurantId, tableId, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create table' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 201, description: 'Table created' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateTableDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.create(restaurantId, dto, user.tenantId);
  }

  @Patch('layout')
  @ApiOperation({ summary: 'Save floor plan layout (bulk position update)' })
  @ApiParam({ name: 'restaurantId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async saveLayout(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: SaveLayoutDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.saveLayout(restaurantId, dto, user.tenantId);
  }

  @Patch(':tableId')
  @ApiOperation({ summary: 'Update table' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async update(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.update(restaurantId, tableId, dto, user.tenantId);
  }

  @Patch(':tableId/status')
  @ApiOperation({ summary: 'Update table status' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'staff')
  async updateStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @Body() dto: UpdateTableStatusDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.updateStatus(restaurantId, tableId, dto, user.tenantId);
  }

  @Delete(':tableId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete table' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async remove(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.tableService.remove(restaurantId, tableId, user.tenantId);
  }
}
