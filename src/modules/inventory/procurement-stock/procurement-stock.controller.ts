import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { ProcurementStockService } from './procurement-stock.service';
import { QueryStockBalanceDto } from './dto/query-balance.dto';
import { QueryLotExpiringDto } from './dto/query-expiring.dto';

@ApiTags('Inventory - Procurement Stock')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/procurement-stock', version: '1' })
export class ProcurementStockController {
  constructor(private readonly service: ProcurementStockService) {}

  @Get('summary')
  @ApiOperation({ summary: 'KPI counts for procurement stock dashboard' })
  @ApiResponse({ status: 200, description: 'Summary retrieved' })
  async summary(
    @Query('warehouseId') warehouseId: string | undefined,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.service.getSummary(req.user.tenantId, warehouseId);
    return { success: true, data };
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Stock balance with health classification (LOW / OVERSTOCK / OK / OUT_OF_STOCK)',
  })
  @ApiResponse({ status: 200, description: 'Balance retrieved' })
  async balance(
    @Query() query: QueryStockBalanceDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.service.findBalance(req.user.tenantId, query);
    return { success: true, data };
  }

  @Get('expiring')
  @ApiOperation({ summary: 'Lots expiring soon or already expired' })
  @ApiResponse({ status: 200, description: 'Expiring lots retrieved' })
  async expiring(
    @Query() query: QueryLotExpiringDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.service.findExpiring(req.user.tenantId, query);
    return { success: true, data };
  }
}
