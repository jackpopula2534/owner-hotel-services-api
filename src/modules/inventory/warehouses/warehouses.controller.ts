import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { WarehousesService } from './warehouses.service';
import { CreateWarehouseDto, WarehouseType } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Inventory - Warehouses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all warehouses for a property' })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Filter by property ID',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: WarehouseType,
    description: 'Filter by warehouse type',
  })
  @ApiResponse({
    status: 200,
    description: 'List of warehouses',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            name: 'Main Store',
            code: 'WH-001',
            propertyId: 'uuid',
            type: 'GENERAL',
            location: 'Ground Floor',
            isDefault: true,
            _count: {
              warehouseStocks: 5,
            },
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
      },
    },
  })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('type') type?: WarehouseType,
  ) {
    const data = await this.warehousesService.findAll(user.tenantId, {
      propertyId,
      type,
    });
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get warehouse by ID' })
  @ApiResponse({
    status: 200,
    description: 'Warehouse details',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Main Store',
          code: 'WH-001',
          propertyId: 'uuid',
          type: 'GENERAL',
          location: 'Ground Floor',
          isDefault: true,
          _count: {
            warehouseStocks: 5,
          },
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.warehousesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new warehouse' })
  @ApiResponse({
    status: 201,
    description: 'Warehouse created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Main Store',
          code: 'WH-001',
          propertyId: 'uuid',
          type: 'GENERAL',
          location: 'Ground Floor',
          isDefault: false,
          _count: {
            warehouseStocks: 0,
          },
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Warehouse code already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWarehouseDto) {
    const data = await this.warehousesService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update warehouse' })
  @ApiResponse({
    status: 200,
    description: 'Warehouse updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          name: 'Updated Store',
          code: 'WH-001',
          propertyId: 'uuid',
          type: 'GENERAL',
          location: 'Ground Floor',
          isDefault: true,
          _count: {
            warehouseStocks: 5,
          },
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  @ApiResponse({ status: 409, description: 'Warehouse code already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    const data = await this.warehousesService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete warehouse (soft delete)' })
  @ApiResponse({ status: 204, description: 'Warehouse deleted successfully' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.warehousesService.remove(id, user.tenantId);
  }
}
