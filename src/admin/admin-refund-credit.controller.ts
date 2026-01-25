import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminRefundCreditService } from './admin-refund-credit.service';
import {
  CreateRefundDto,
  CreateCreditDto,
  ApplyCreditDto,
  ProcessRefundDto,
  TenantCreditsListDto,
  RefundItemDto,
  CreateRefundResponseDto,
  CreateCreditResponseDto,
  ApplyCreditResponseDto,
  ProcessRefundResponseDto,
  RefundSummaryDto,
} from './dto/admin-refund-credit.dto';

@ApiTags('Admin - Refund & Credit System')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminRefundCreditController {
  constructor(
    private readonly adminRefundCreditService: AdminRefundCreditService,
  ) {}

  // ============ REFUND ENDPOINTS ============

  /**
   * POST /api/v1/admin/payments/:id/refund
   * Create a refund for a payment
   */
  @Post('payments/:id/refund')
  @ApiOperation({
    summary: 'Create refund',
    description: 'Create a refund for an approved payment. Can refund via original method, bank transfer, or credit.',
  })
  @ApiParam({ name: 'id', description: 'Payment ID (UUID)' })
  @ApiResponse({
    status: 201,
    description: 'Refund created successfully',
    type: CreateRefundResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - payment not approved or insufficient amount' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async createRefund(
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<CreateRefundResponseDto> {
    return this.adminRefundCreditService.createRefund(id, dto, user?.userId);
  }

  /**
   * GET /api/v1/admin/refunds
   * Get all refunds
   */
  @Get('refunds')
  @ApiOperation({
    summary: 'Get all refunds',
    description: 'Get list of all refunds with optional status filter',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected', 'completed'] })
  @ApiResponse({
    status: 200,
    description: 'Refunds retrieved successfully',
    type: [RefundItemDto],
  })
  async getRefunds(
    @Query('status') status?: string,
  ): Promise<RefundItemDto[]> {
    return this.adminRefundCreditService.getRefunds(status);
  }

  /**
   * GET /api/v1/admin/refunds/summary
   * Get refund summary
   */
  @Get('refunds/summary')
  @ApiOperation({
    summary: 'Get refund summary',
    description: 'Get summary statistics of refunds',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary retrieved successfully',
    type: RefundSummaryDto,
  })
  async getRefundSummary(): Promise<RefundSummaryDto> {
    return this.adminRefundCreditService.getRefundSummary();
  }

  /**
   * PATCH /api/v1/admin/refunds/:id/process
   * Process (approve/reject) a refund
   */
  @Patch('refunds/:id/process')
  @ApiOperation({
    summary: 'Process refund',
    description: 'Approve or reject a pending refund request',
  })
  @ApiParam({ name: 'id', description: 'Refund ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Refund processed successfully',
    type: ProcessRefundResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - refund not in pending status' })
  @ApiResponse({ status: 404, description: 'Refund not found' })
  async processRefund(
    @Param('id') id: string,
    @Body() dto: ProcessRefundDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<ProcessRefundResponseDto> {
    return this.adminRefundCreditService.processRefund(id, dto, user?.userId);
  }

  // ============ CREDIT ENDPOINTS ============

  /**
   * GET /api/v1/admin/tenants/:id/credits
   * Get all credits for a tenant
   */
  @Get('tenants/:id/credits')
  @ApiOperation({
    summary: 'Get tenant credits',
    description: 'Get all credits and credit balance for a tenant',
  })
  @ApiParam({ name: 'id', description: 'Tenant ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Credits retrieved successfully',
    type: TenantCreditsListDto,
  })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async getTenantCredits(
    @Param('id') id: string,
  ): Promise<TenantCreditsListDto> {
    return this.adminRefundCreditService.getTenantCredits(id);
  }

  /**
   * POST /api/v1/admin/tenants/:id/credits
   * Add credit to a tenant
   */
  @Post('tenants/:id/credits')
  @ApiOperation({
    summary: 'Add credit',
    description: 'Add credit to a tenant account (manual, promotional, etc.)',
  })
  @ApiParam({ name: 'id', description: 'Tenant ID (UUID)' })
  @ApiResponse({
    status: 201,
    description: 'Credit added successfully',
    type: CreateCreditResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Tenant not found' })
  async addCredit(
    @Param('id') id: string,
    @Body() dto: CreateCreditDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<CreateCreditResponseDto> {
    return this.adminRefundCreditService.addCredit(id, dto, user?.userId);
  }

  /**
   * POST /api/v1/admin/invoices/:id/apply-credit
   * Apply credit to an invoice
   */
  @Post('invoices/:id/apply-credit')
  @ApiOperation({
    summary: 'Apply credit to invoice',
    description: 'Apply tenant credit balance to pay an invoice (partially or fully)',
  })
  @ApiParam({ name: 'id', description: 'Invoice ID (UUID)' })
  @ApiResponse({
    status: 201,
    description: 'Credit applied successfully',
    type: ApplyCreditResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - invoice already paid or no credit available' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async applyCredit(
    @Param('id') id: string,
    @Body() dto: ApplyCreditDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<ApplyCreditResponseDto> {
    return this.adminRefundCreditService.applyCredit(id, dto, user?.userId);
  }
}
