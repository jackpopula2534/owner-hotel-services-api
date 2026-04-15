import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StockMovementsService } from './stock-movements.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';

@ApiTags('Inventory - Stock Movements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/stock-movements', version: '1' })
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Get()
  @ApiOperation({ summary: 'List stock movements with filters' })
  @ApiResponse({ status: 200, description: 'Stock movements retrieved' })
  async findAll(
    @Query() query: QueryStockMovementDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.findAll(req.user.tenantId, query);
    return { success: true, data };
  }

  @Get('by-item/:itemId')
  @ApiOperation({ summary: 'Get movement history for a specific item' })
  @ApiResponse({ status: 200, description: 'Movement history retrieved' })
  async getMovementsByItem(
    @Param('itemId') itemId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Req() req?: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.getMovementsByItem(
      itemId,
      req.user.tenantId,
      page,
      limit,
    );
    return { success: true, data };
  }

  @Get('by-warehouse/:warehouseId')
  @ApiOperation({ summary: 'Get movement history for a specific warehouse' })
  @ApiResponse({ status: 200, description: 'Movement history retrieved' })
  async getMovementsByWarehouse(
    @Param('warehouseId') warehouseId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Req() req?: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.getMovementsByWarehouse(
      warehouseId,
      req.user.tenantId,
      page,
      limit,
    );
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get stock movement details' })
  @ApiResponse({ status: 200, description: 'Stock movement retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.findOne(id, req.user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a stock movement' })
  @ApiResponse({ status: 201, description: 'Stock movement created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async create(
    @Body() dto: CreateStockMovementDto,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.createMovement(
      dto,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post('transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a transfer between warehouses' })
  @ApiResponse({ status: 201, description: 'Transfer created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.stockMovementsService.createTransfer(
      dto,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }
}
