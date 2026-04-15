import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { ReorderAlertsService } from './reorder-alerts.service';

@ApiTags('Inventory - Reorder Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/reorder-alerts', version: '1' })
export class ReorderAlertsController {
  constructor(private readonly reorderAlertsService: ReorderAlertsService) {}

  @ApiOperation({ summary: 'Get all low stock alerts' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiResponse({ status: 200, description: 'Low stock alerts list' })
  @Get()
  async getAlerts(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.reorderAlertsService.getLowStockAlerts(req.user.tenantId, {
      propertyId,
      warehouseId,
    });
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Get reorder summary (aggregated)' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiResponse({ status: 200, description: 'Reorder summary' })
  @Get('summary')
  async getSummary(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.reorderAlertsService.getReorderSummary(req.user.tenantId, {
      propertyId,
    });
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Generate PO suggestions from low stock items' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiResponse({ status: 200, description: 'PO suggestions grouped by supplier' })
  @Get('po-suggestions')
  async getPOSuggestions(
    @Req() req: { user: { tenantId: string } },
    @Query('warehouseId') warehouseId: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.reorderAlertsService.generatePOSuggestions(
      req.user.tenantId,
      warehouseId,
    );
    return { success: true, data };
  }
}
