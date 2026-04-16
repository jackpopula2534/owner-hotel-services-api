import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
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
} from '@nestjs/swagger';
import { PriceComparisonsService } from './price-comparisons.service';
import { CreatePriceComparisonDto, SelectQuoteDto } from './dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Inventory - Price Comparisons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/price-comparisons', version: '1' })
export class PriceComparisonsController {
  constructor(
    private readonly priceComparisonsService: PriceComparisonsService,
  ) {}

  @Get('by-pr/:prId')
  @ApiOperation({
    summary: 'Get price comparison for a purchase requisition with full matrix',
  })
  @ApiParam({ name: 'prId', description: 'Purchase requisition ID' })
  @ApiResponse({
    status: 200,
    description: 'Price comparison with comparison matrix retrieved',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getByPR(
    @Param('prId') prId: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.getByPR(
      prId,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create new price comparison for a purchase requisition',
  })
  @ApiResponse({ status: 201, description: 'Price comparison created' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async create(
    @Body() dto: CreatePriceComparisonDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.create(
      dto,
      user.id,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Patch(':id/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select a supplier quote within price comparison' })
  @ApiParam({ name: 'id', description: 'Price comparison ID' })
  @ApiResponse({
    status: 200,
    description: 'Quote selected in price comparison',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async selectQuote(
    @Param('id') id: string,
    @Body() dto: SelectQuoteDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.selectQuote(
      id,
      dto,
      user.id,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve price comparison and update PR status',
  })
  @ApiParam({ name: 'id', description: 'Price comparison ID' })
  @ApiResponse({
    status: 200,
    description: 'Price comparison approved',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.approve(
      id,
      user.id,
      user.tenantId,
    );
    return { success: true, data };
  }
}
