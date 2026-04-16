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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { QueryPurchaseRequisitionDto } from './dto/query-purchase-requisition.dto';

@ApiTags('Inventory - Purchase Requisitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/purchase-requisitions', version: '1' })
export class PurchaseRequisitionsController {
  constructor(
    private readonly purchaseRequisitionsService: PurchaseRequisitionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List purchase requisitions with pagination' })
  @ApiResponse({ status: 200, description: 'Purchase requisitions retrieved' })
  async findAll(
    @Query() query: QueryPurchaseRequisitionDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown; meta: unknown }> {
    const result = await this.purchaseRequisitionsService.findAll(
      req.user.tenantId,
      query,
    );
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase requisition detail with items' })
  @ApiResponse({ status: 200, description: 'Purchase requisition retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.findOne(
      id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new purchase requisition in DRAFT status' })
  @ApiResponse({ status: 201, description: 'Purchase requisition created' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async create(
    @Body() dto: CreatePurchaseRequisitionDto,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.create(
      dto,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update purchase requisition (DRAFT or PENDING_APPROVAL only)',
  })
  @ApiResponse({ status: 200, description: 'Purchase requisition updated' })
  @ApiResponse({
    status: 400,
    description: 'Invalid status for update',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseRequisitionDto,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.update(
      id,
      dto,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/submit')
  @ApiOperation({
    summary: 'Submit purchase requisition for approval (DRAFT → PENDING_APPROVAL)',
  })
  @ApiResponse({ status: 200, description: 'Submitted for approval' })
  async submit(
    @Param('id') id: string,
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.submit(
      id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/approve')
  @ApiOperation({
    summary:
      'Approve purchase requisition (PENDING_APPROVAL → APPROVED)',
  })
  @ApiResponse({ status: 200, description: 'Purchase requisition approved' })
  async approve(
    @Param('id') id: string,
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.approve(
      id,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/request-quotes')
  @ApiOperation({
    summary:
      'Request quotes from suppliers (APPROVED → PENDING_QUOTES)',
  })
  @ApiResponse({ status: 200, description: 'Quotes requested' })
  async requestQuotes(
    @Param('id') id: string,
    @Body() body: { supplierIds: string[] },
    @Req() req: { user: { tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.requestQuotes(
      id,
      body.supplierIds,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel purchase requisition with reason',
  })
  @ApiResponse({ status: 200, description: 'Purchase requisition cancelled' })
  async cancel(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.cancel(
      id,
      body.reason,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/create-po')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create Purchase Order from approved PR using selected quote (PENDING_QUOTES → PO_CREATED)',
  })
  @ApiResponse({ status: 201, description: 'Purchase order created' })
  async createPO(
    @Param('id') id: string,
    @Body() body: { selectedQuoteId: string; warehouseId: string },
    @Req() req: { user: { id: string; tenantId: string } },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.purchaseRequisitionsService.createPOFromPR(
      id,
      body.selectedQuoteId,
      body.warehouseId,
      req.user.id,
      req.user.tenantId,
    );
    return { success: true, data };
  }
}
