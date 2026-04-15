import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PeriodCloseService } from './period-close.service';
import { ClosePeriodDto } from './dto/close-period.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';

@ApiTags('Cost Accounting - Period Close')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@Controller({ path: 'cost-accounting/period-close', version: '1' })
export class PeriodCloseController {
  constructor(private readonly periodCloseService: PeriodCloseService) {}

  @Get()
  @ApiOperation({ summary: 'List all period closes' })
  @ApiResponse({ status: 200, description: 'Period closes retrieved' })
  async findAll(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.periodCloseService.findAll(req.user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current open period' })
  @ApiResponse({ status: 200, description: 'Current period retrieved' })
  async getCurrentPeriod(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.periodCloseService.getCurrentPeriod(req.user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get period close details with analyses' })
  @ApiResponse({ status: 200, description: 'Period close retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.periodCloseService.findOne(id, req.user.tenantId);
    return { success: true, data };
  }

  @Post('close')
  @ApiOperation({ summary: 'Close a period and generate analyses' })
  @ApiResponse({ status: 200, description: 'Period closed' })
  @ApiResponse({ status: 400, description: 'Invalid period or already closed' })
  async closePeriod(
    @Body() dto: ClosePeriodDto,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.periodCloseService.closePeriod(dto, req.user.id, req.user.tenantId);
    return { success: true, data };
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed period' })
  @ApiResponse({ status: 200, description: 'Period reopened' })
  @ApiResponse({ status: 400, description: 'Period not closed' })
  async reopenPeriod(
    @Param('id') id: string,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.periodCloseService.reopenPeriod(id, req.user.id, req.user.tenantId);
    return { success: true, data };
  }
}
