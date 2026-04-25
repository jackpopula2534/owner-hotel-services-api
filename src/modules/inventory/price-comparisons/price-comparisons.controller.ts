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
  ApiBody,
} from '@nestjs/swagger';
import { PriceComparisonsService } from './price-comparisons.service';
import { CreatePriceComparisonDto, SelectQuoteDto, RejectComparisonDto } from './dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

const APPROVER_ROLES = [
  'procurement_manager',
  'admin',
  'platform_admin',
  'tenant_admin',
  'manager',
] as const;

@ApiTags('Inventory - Price Comparisons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/price-comparisons', version: '1' })
export class PriceComparisonsController {
  constructor(private readonly priceComparisonsService: PriceComparisonsService) {}

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
    const data = await this.priceComparisonsService.getByPR(prId, user.tenantId);
    return { success: true, data };
  }

  @Get('pending-approval')
  @Roles(...APPROVER_ROLES)
  @ApiOperation({
    summary: 'List price comparisons pending supervisor approval',
  })
  @ApiResponse({
    status: 200,
    description: 'Comparisons in PENDING_APPROVAL status',
  })
  async findPendingApprovals(
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.findPendingApprovals(user.tenantId);
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
    const data = await this.priceComparisonsService.create(dto, user.id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select a supplier quote within price comparison' })
  @ApiParam({ name: 'id', description: 'Price comparison ID' })
  @ApiResponse({
    status: 200,
    description: 'Quote selected — comparison moved to PENDING_APPROVAL',
  })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async selectQuote(
    @Param('id') id: string,
    @Body() dto: SelectQuoteDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.selectQuote(id, dto, user.id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...APPROVER_ROLES)
  @ApiOperation({
    summary: 'Approve price comparison (procurement_manager / admin / manager only)',
  })
  @ApiParam({ name: 'id', description: 'Price comparison ID' })
  @ApiResponse({
    status: 200,
    description: 'Price comparison approved',
  })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({
    status: 400,
    description: 'Comparison not in PENDING_APPROVAL status',
  })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.approve(id, user.id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...APPROVER_ROLES)
  @ApiOperation({
    summary: 'Reject price comparison with reason (procurement_manager / admin / manager only)',
  })
  @ApiParam({ name: 'id', description: 'Price comparison ID' })
  @ApiBody({ type: RejectComparisonDto })
  @ApiResponse({ status: 200, description: 'Price comparison rejected' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({
    status: 400,
    description: 'Comparison not in PENDING_APPROVAL status',
  })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectComparisonDto,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.priceComparisonsService.reject(id, dto, user.id, user.tenantId);
    return { success: true, data };
  }
}
