import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { GoodsReceivesService, GoodsReceiveDetail, PaginatedResponse } from './goods-receives.service';
import { CreateGoodsReceiveDto } from './dto/create-goods-receive.dto';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
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

@ApiTags('Inventory - Goods Receive')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/goods-receives', version: '1' })
export class GoodsReceivesController {
  constructor(private readonly goodsReceivesService: GoodsReceivesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all goods receives with pagination and filters',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort field: createdAt, grNumber, warehouseId, itemCount',
  })
  @ApiQuery({ name: 'order', required: false, description: 'asc, desc' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'purchaseOrderId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'DRAFT, RECEIVED, INSPECTED, REJECTED',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of goods receives',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            grNumber: 'GR-202604-0001',
            poNumber: 'PO-202604-0001',
            warehouseName: 'Main Warehouse',
            status: 'RECEIVED',
            itemCount: 3,
            totalReceivedQty: 25,
            totalRejectedQty: 2,
            createdAt: '2026-04-14T10:00:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 10, totalPages: 1 },
      },
    },
  })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryGoodsReceiveDto): Promise<{ success: boolean } & PaginatedResponse<GoodsReceiveDetail>> {
    const result = await this.goodsReceivesService.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get goods receive details with items' })
  @ApiResponse({
    status: 200,
    description: 'Goods receive detail with all items',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          grNumber: 'GR-202604-0001',
          poNumber: 'PO-202604-0001',
          warehouseName: 'Main Warehouse',
          invoiceNumber: 'INV-2026-001',
          status: 'RECEIVED',
          itemCount: 3,
          totalReceivedQty: 25,
          items: [
            {
              itemId: 'uuid',
              itemName: 'Tomato Fresh',
              itemSku: 'SKU-001',
              receivedQty: 10,
              rejectedQty: 1,
              unitCost: 150.5,
              batchNumber: 'BATCH-2026-001',
              expiryDate: '2026-06-14T00:00:00Z',
            },
          ],
          createdAt: '2026-04-14T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Goods receive not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new goods receive and update stock' })
  @ApiResponse({
    status: 201,
    description: 'Goods receive created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid item/warehouse',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict: PO status invalid or stock conflict',
  })
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateGoodsReceiveDto): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.create(createDto, user.userId, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/inspect')
  @ApiOperation({
    summary: 'Mark goods receive as inspected or rejected',
  })
  @ApiResponse({ status: 200, description: 'Inspection status updated' })
  @ApiResponse({ status: 404, description: 'Goods receive not found' })
  @ApiResponse({
    status: 409,
    description: 'Invalid status transition',
  })
  async inspect(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('status') status: 'INSPECTING' | 'REJECTED',
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.inspect(id, user.userId, user.tenantId, status);
    return { success: true, data };
  }
}
