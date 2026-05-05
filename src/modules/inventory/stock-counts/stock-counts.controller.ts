import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { StockCountsService, StockCountDetail, PaginatedResponse } from './stock-counts.service';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { UpdateStockCountItemDto } from './dto/update-stock-count-item.dto';
import { QueryStockCountDto } from './dto/query-stock-count.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Inventory - Stock Counts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/stock-counts', version: '1' })
export class StockCountsController {
  constructor(private readonly stockCountsService: StockCountsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all stock counts with pagination and filters',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort field: createdAt, scNumber, warehouseId, status',
  })
  @ApiQuery({ name: 'order', required: false, description: 'asc, desc' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'PLANNED, IN_PROGRESS, COMPLETED, APPROVED, CANCELLED',
  })
  @ApiQuery({
    name: 'countType',
    required: false,
    description: 'FULL, PARTIAL, CYCLE',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of stock counts',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            scNumber: 'SC-202604-0001',
            warehouseName: 'Main Warehouse',
            countType: 'FULL',
            status: 'IN_PROGRESS',
            totalItemCount: 150,
            countedItems: 45,
            varianceItems: 3,
            createdAt: '2026-04-14T10:00:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 10, totalPages: 1 },
      },
    },
  })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryStockCountDto,
  ): Promise<{ success: boolean } & PaginatedResponse<StockCountDetail>> {
    const result = await this.stockCountsService.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get stock count details with items' })
  @ApiResponse({
    status: 200,
    description: 'Stock count detail with all items',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          scNumber: 'SC-202604-0001',
          warehouseName: 'Main Warehouse',
          countType: 'FULL',
          status: 'IN_PROGRESS',
          totalItemCount: 150,
          countedItems: 45,
          items: [
            {
              itemId: 'uuid',
              itemName: 'Tomato Fresh',
              itemSku: 'SKU-001',
              systemQty: 50,
              actualQty: 48,
              variance: -2,
              varianceValue: -300,
              countedBy: 'uuid',
              countedAt: '2026-04-14T11:00:00Z',
            },
          ],
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Stock count not found' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create new stock count (auto-populates items or uses provided list)',
  })
  @ApiResponse({
    status: 201,
    description: 'Stock count created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid warehouse',
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateStockCountDto,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.create(createDto, user.id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start stock count (PLANNED → IN_PROGRESS)' })
  @ApiResponse({ status: 200, description: 'Stock count started' })
  @ApiResponse({ status: 404, description: 'Stock count not found' })
  @ApiResponse({
    status: 409,
    description: 'Invalid status transition',
  })
  async startCount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.startCount(id, user.id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({
    summary: 'Record actual count for a specific item',
  })
  @ApiResponse({
    status: 200,
    description: 'Item count recorded',
  })
  @ApiResponse({ status: 404, description: 'Stock count or item not found' })
  @ApiResponse({
    status: 409,
    description: 'Stock count not in IN_PROGRESS status',
  })
  async recordCount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() updateDto: UpdateStockCountItemDto,
  ) {
    const data = await this.stockCountsService.recordCount(
      id,
      itemId,
      updateDto,
      user.id,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete stock count (IN_PROGRESS → COMPLETED)' })
  @ApiResponse({
    status: 200,
    description: 'Stock count completed',
  })
  @ApiResponse({ status: 404, description: 'Stock count not found' })
  @ApiResponse({
    status: 409,
    description: 'Stock count not in IN_PROGRESS status',
  })
  async completeCount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.completeCount(id, user.id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve stock count and post adjustments (COMPLETED → APPROVED)',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock count approved, adjustments posted',
  })
  @ApiResponse({ status: 404, description: 'Stock count not found' })
  @ApiResponse({
    status: 409,
    description: 'Stock count not in COMPLETED status',
  })
  async approveCount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.approveCount(id, user.id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel stock count' })
  @ApiResponse({
    status: 200,
    description: 'Stock count cancelled',
  })
  @ApiResponse({ status: 404, description: 'Stock count not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot cancel approved or already cancelled count',
  })
  async cancelCount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: StockCountDetail }> {
    const data = await this.stockCountsService.cancelCount(id, user.tenantId);
    return { success: true, data };
  }
}
