import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { QueryPurchaseOrderTrackingDto } from './dto/query-purchase-order-tracking.dto';

@ApiTags('Inventory - Purchase Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/purchase-orders', version: '1' })
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiResponse({ status: 200, description: 'Purchase orders retrieved' })
  async findAll(
    @Query() query: QueryPurchaseOrderDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.findAll(req.user.tenantId, query);
    return { success: true, data };
  }

  /**
   * Sprint 1 — Receiving Pipeline view for the procurement side.
   * Registered before `:id` so the literal "tracking" segment is matched first
   * (NestJS uses declaration order for routes that share a prefix).
   */
  @Get('tracking')
  @ApiOperation({
    summary: 'Receiving pipeline — list post-approval POs with received-vs-ordered roll-ups',
  })
  @ApiResponse({ status: 200, description: 'Tracking list retrieved' })
  async findTracking(
    @Query() query: QueryPurchaseOrderTrackingDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.findTracking(req.user.tenantId, query);
    return { success: true, data };
  }

  /**
   * Sprint 4 — Variance Report. Returns POs with non-zero delta between
   * ordered/received/invoiced. Registered before `:id` for the same reason
   * as `/tracking`.
   */
  @Get('variance')
  @ApiOperation({ summary: 'Variance report — PO ordered vs received vs invoiced' })
  @ApiResponse({ status: 200, description: 'Variance retrieved' })
  async findVariance(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('supplierId') supplierId: string | undefined,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.findVariance(req.user.tenantId, {
      from,
      to,
      supplierId,
    });
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase order detail' })
  @ApiResponse({ status: 200, description: 'Purchase order retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.findOne(id, req.user.tenantId);
    return { success: true, data };
  }

  /**
   * Sprint 2 — line-level receiving tab. Returns per-line ordered/received/pending
   * plus the full list of linked GRs. Cheaper than `findOne` when the UI only
   * needs the receiving breakdown (PO Detail "การรับเข้า" tab).
   */
  @Get(':id/receiving')
  @ApiOperation({ summary: 'Receiving breakdown — line-level + GR list' })
  @ApiResponse({ status: 200, description: 'Receiving detail retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findReceiving(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.findReceiving(id, req.user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create purchase order' })
  @ApiResponse({ status: 201, description: 'Purchase order created' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async create(
    @Body() dto: CreatePurchaseOrderDto,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.create(dto, req.user.id, req.user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase order (DRAFT only)' })
  @ApiResponse({ status: 200, description: 'Purchase order updated' })
  @ApiResponse({ status: 400, description: 'Invalid status for update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.update(id, dto, req.user.tenantId);
    return { success: true, data };
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit for approval' })
  @ApiResponse({ status: 200, description: 'Submitted for approval' })
  async submitForApproval(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.submitForApproval(id, req.user.tenantId);
    return { success: true, data };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order approved' })
  async approve(
    @Param('id') id: string,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.approve(id, req.user.id, req.user.tenantId);
    return { success: true, data };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order cancelled' })
  async cancel(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.cancel(
      id,
      req.user.id,
      body.reason,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order closed' })
  async close(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.close(id, req.user.tenantId);
    return { success: true, data };
  }

  /**
   * Sprint 4 — Force-close a PO that won't be received in full.
   * Allowed only for APPROVED or PARTIALLY_RECEIVED. Reason is required.
   */
  @Post(':id/force-close')
  @ApiOperation({ summary: 'Force-close PO with outstanding qty (records variance)' })
  @ApiResponse({ status: 200, description: 'Purchase order force-closed' })
  @ApiResponse({ status: 400, description: 'Invalid status or missing reason' })
  async forceClose(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseOrdersService.forceClose(
      id,
      req.user.id,
      body.reason,
      req.user.tenantId,
    );
    return { success: true, data };
  }
}
