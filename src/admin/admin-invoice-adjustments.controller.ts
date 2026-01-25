import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminInvoiceAdjustmentsService } from './admin-invoice-adjustments.service';
import {
  AdjustInvoiceDto,
  VoidInvoiceDto,
  UpdateInvoiceItemDto,
  InvoiceAdjustmentsListDto,
  AdjustInvoiceResponseDto,
  VoidInvoiceResponseDto,
  UpdateInvoiceItemResponseDto,
  InvoiceWithItemsDto,
} from './dto/admin-invoice-adjustments.dto';

@ApiTags('Admin - Invoice Adjustment')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminInvoiceAdjustmentsController {
  constructor(
    private readonly adminInvoiceAdjustmentsService: AdminInvoiceAdjustmentsService,
  ) {}

  /**
   * GET /api/v1/admin/invoices/:id/items
   * Get invoice with line items
   */
  @Get('invoices/:id/items')
  @ApiOperation({
    summary: 'Get invoice with line items',
    description: 'Get invoice details with all line items for editing',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID or Invoice Number (e.g., INV-2024-045)' })
  @ApiResponse({
    status: 200,
    description: 'Invoice with items retrieved successfully',
    type: InvoiceWithItemsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async getInvoiceWithItems(
    @Param('id') id: string,
  ): Promise<InvoiceWithItemsDto> {
    return this.adminInvoiceAdjustmentsService.getInvoiceWithItems(id);
  }

  /**
   * GET /api/v1/admin/invoices/:id/adjustments
   * Get adjustment history for an invoice
   */
  @Get('invoices/:id/adjustments')
  @ApiOperation({
    summary: 'Get invoice adjustments',
    description: 'Get history of all adjustments made to an invoice',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID or Invoice Number' })
  @ApiResponse({
    status: 200,
    description: 'Adjustments retrieved successfully',
    type: InvoiceAdjustmentsListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async getAdjustments(
    @Param('id') id: string,
  ): Promise<InvoiceAdjustmentsListDto> {
    return this.adminInvoiceAdjustmentsService.getAdjustments(id);
  }

  /**
   * POST /api/v1/admin/invoices/:id/adjust
   * Adjust invoice amount (discount, credit, surcharge, proration)
   */
  @Post('invoices/:id/adjust')
  @ApiOperation({
    summary: 'Adjust invoice',
    description: 'Apply adjustment to invoice (discount, credit, surcharge, proration)',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID or Invoice Number' })
  @ApiResponse({
    status: 201,
    description: 'Invoice adjusted successfully',
    type: AdjustInvoiceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid adjustment or voided invoice' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async adjustInvoice(
    @Param('id') id: string,
    @Body() dto: AdjustInvoiceDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<AdjustInvoiceResponseDto> {
    return this.adminInvoiceAdjustmentsService.adjustInvoice(id, dto, user?.userId);
  }

  /**
   * POST /api/v1/admin/invoices/:id/void
   * Void an invoice
   */
  @Post('invoices/:id/void')
  @ApiOperation({
    summary: 'Void invoice',
    description: 'Void an invoice with optional credit creation for paid invoices',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID or Invoice Number' })
  @ApiResponse({
    status: 201,
    description: 'Invoice voided successfully',
    type: VoidInvoiceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - invoice already voided' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async voidInvoice(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<VoidInvoiceResponseDto> {
    return this.adminInvoiceAdjustmentsService.voidInvoice(id, dto, user?.userId);
  }

  /**
   * PATCH /api/v1/admin/invoice-items/:id
   * Update an invoice line item
   */
  @Patch('invoice-items/:id')
  @ApiOperation({
    summary: 'Update invoice item',
    description: 'Update quantity, price, or description of an invoice line item (pending invoices only)',
  })
  @ApiParam({ name: 'id', description: 'Invoice Item ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Invoice item updated successfully',
    type: UpdateInvoiceItemResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - cannot update paid/voided invoice' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice item not found' })
  async updateInvoiceItem(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceItemDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<UpdateInvoiceItemResponseDto> {
    return this.adminInvoiceAdjustmentsService.updateInvoiceItem(id, dto, user?.userId);
  }
}
