import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
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
import { AdminInvoicesService } from './admin-invoices.service';
import {
  AdminInvoicesQueryDto,
  AdminInvoicesListResponseDto,
  AdminInvoicesSummaryDto,
  AdminInvoiceDetailDto,
  UpdateInvoiceStatusDto,
  InvoiceStatusUpdateResponseDto,
} from './dto/admin-invoices.dto';

@ApiTags('Admin - Invoices Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/invoices', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminInvoicesController {
  constructor(private readonly adminInvoicesService: AdminInvoicesService) {}

  /**
   * GET /api/v1/admin/invoices
   * Get all invoices with filtering, search, and pagination
   */
  @Get()
  @ApiOperation({
    summary: 'Get all invoices',
    description:
      'Retrieve a paginated list of all invoices with optional filtering by status and search',
  })
  @ApiResponse({
    status: 200,
    description: 'Invoices retrieved successfully',
    type: AdminInvoicesListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  async findAll(
    @Query() query: AdminInvoicesQueryDto,
  ): Promise<AdminInvoicesListResponseDto> {
    return this.adminInvoicesService.findAll(query);
  }

  /**
   * GET /api/v1/admin/invoices/summary
   * Get invoices summary by status
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Get invoices summary',
    description:
      'Retrieve summary counts of invoices grouped by status (Pending, Paid, Rejected)',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary retrieved successfully',
    type: AdminInvoicesSummaryDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  async getSummary(): Promise<AdminInvoicesSummaryDto> {
    return this.adminInvoicesService.getSummary();
  }

  /**
   * GET /api/v1/admin/invoices/:id
   * Get invoice detail by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get invoice detail',
    description: 'Retrieve detailed information for a specific invoice',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Invoice detail retrieved successfully',
    type: AdminInvoiceDetailDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminInvoiceDetailDto> {
    return this.adminInvoicesService.findOne(id);
  }

  /**
   * PATCH /api/v1/admin/invoices/:id/status
   * Update invoice status (approve/reject)
   */
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update invoice status',
    description: 'Approve or reject an invoice',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Invoice status updated successfully',
    type: InvoiceStatusUpdateResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInvoiceStatusDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<InvoiceStatusUpdateResponseDto> {
    return this.adminInvoicesService.updateStatus(id, dto, user?.userId);
  }
}
