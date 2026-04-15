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
import { ItemsService, ItemWithStock, StockSummary, PaginatedResponse } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
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

@ApiTags('Inventory - Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/items', version: '1' })
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all items with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or SKU' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category ID' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'isPerishable', required: false, type: Boolean })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort field: createdAt, name, sku, totalStock, updatedAt',
  })
  @ApiQuery({ name: 'order', required: false, description: 'Sort direction: asc, desc' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of items',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            sku: 'SKU-001',
            name: 'Tomato Fresh',
            description: 'Fresh red tomatoes',
            categoryId: 'uuid',
            unit: 'KG',
            costMethod: 'WEIGHTED_AVG',
            reorderPoint: 10,
            reorderQty: 50,
            maxStock: 200,
            minStock: 5,
            barcode: '1234567890123',
            brand: 'Fresh Farm Co.',
            imageUrl: 'https://example.com/tomato.jpg',
            isPerishable: true,
            defaultShelfLifeDays: 7,
            isActive: true,
            category: { id: 'uuid', name: 'Vegetables' },
            totalStock: 45,
            lowStock: false,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 100, totalPages: 5 },
      },
    },
  })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryItemDto): Promise<{ success: boolean } & PaginatedResponse<ItemWithStock>> {
    const result = await this.itemsService.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Get items with low stock (quantity < reorderPoint)' })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Filter by property ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of low stock items',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            sku: 'SKU-001',
            name: 'Tomato Fresh',
            totalStock: 5,
            reorderPoint: 10,
            reorderQty: 50,
          },
        ],
      },
    },
  })
  async getLowStockItems(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
  ) {
    const data = await this.itemsService.getLowStockItems(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get stock summary (total items, value, low stock count, out of stock count)',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Filter by property ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock summary',
    schema: {
      example: {
        success: true,
        data: {
          totalItems: 150,
          totalValue: 45000.5,
          lowStockCount: 12,
          outOfStockCount: 3,
        },
      },
    },
  })
  async getStockSummary(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId?: string): Promise<{ success: boolean; data: StockSummary }> {
    const data = await this.itemsService.getStockSummary(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get item by ID with full details' })
  @ApiResponse({
    status: 200,
    description: 'Item details with suppliers and warehouse stocks',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh',
          description: 'Fresh red tomatoes',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 10,
          reorderQty: 50,
          maxStock: 200,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          category: { id: 'uuid', name: 'Vegetables', code: 'CAT-VEG-001' },
          itemSuppliers: [
            {
              id: 'uuid',
              itemId: 'uuid',
              supplierId: 'uuid',
              supplier: {
                id: 'uuid',
                name: 'Fresh Farm Supplier',
                contactPerson: 'John Doe',
                phone: '0812345678',
                email: 'john@farm.com',
              },
            },
          ],
          warehouseStocks: [
            {
              id: 'uuid',
              warehouseId: 'uuid',
              itemId: 'uuid',
              quantity: 45,
              avgCost: 50.0,
              totalValue: 2250.0,
              warehouse: { id: 'uuid', name: 'Main Store' },
            },
          ],
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.itemsService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new item' })
  @ApiResponse({
    status: 201,
    description: 'Item created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh',
          description: 'Fresh red tomatoes',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 10,
          reorderQty: 50,
          maxStock: 200,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or invalid categoryId' })
  @ApiResponse({ status: 409, description: 'Item SKU already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateItemDto) {
    const data = await this.itemsService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item' })
  @ApiResponse({
    status: 200,
    description: 'Item updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh - Updated',
          description: 'Fresh red tomatoes from local farm',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 15,
          reorderQty: 60,
          maxStock: 250,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or invalid categoryId' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'Item SKU already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    const data = await this.itemsService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete item (soft delete)' })
  @ApiResponse({ status: 204, description: 'Item deleted successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.itemsService.remove(id, user.tenantId);
  }
}
