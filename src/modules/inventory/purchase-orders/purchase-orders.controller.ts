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
}
