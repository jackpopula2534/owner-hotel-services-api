import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PromptPayService } from './promptpay.service';
import {
  GenerateQRCodeDto,
  VerifyPaymentDto,
  WebhookPaymentDto,
  TransactionQueryDto,
  RefundRequestDto,
} from './dto/promptpay.dto';

@ApiTags('PromptPay Payment')
@Controller('payments/promptpay')
export class PromptPayController {
  constructor(private readonly promptPayService: PromptPayService) {}

  @Post('generate-qr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate PromptPay QR code for payment' })
  @ApiResponse({ status: 200, description: 'QR code generated successfully' })
  async generateQRCode(@Body() dto: GenerateQRCodeDto, @Request() req: any) {
    const tenantId = dto.tenantId || req.user?.tenantId;
    return this.promptPayService.generateQRCode({ ...dto, tenantId });
  }

  @Get('status/:transactionRef')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check payment status' })
  @ApiResponse({ status: 200, description: 'Payment status retrieved' })
  async checkStatus(@Param('transactionRef') transactionRef: string) {
    return this.promptPayService.checkPaymentStatus(transactionRef);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook endpoint for payment notifications' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(@Body() dto: WebhookPaymentDto) {
    return this.promptPayService.handleWebhook(dto);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually verify a payment (admin)' })
  @ApiResponse({ status: 200, description: 'Payment verified' })
  async verifyPayment(@Body() dto: VerifyPaymentDto, @Request() req: any) {
    return this.promptPayService.verifyPayment(dto.transactionRef, req.user?.id);
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'manager', 'accountant')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get PromptPay transaction history' })
  @ApiResponse({ status: 200, description: 'Transaction list retrieved' })
  async getTransactions(@Query() query: TransactionQueryDto, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.promptPayService.getTransactions(query, tenantId);
  }

  @Get('reconciliation/:date')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'accountant')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get daily reconciliation report' })
  @ApiResponse({ status: 200, description: 'Reconciliation report retrieved' })
  async getReconciliation(@Param('date') date: string, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.promptPayService.getDailyReconciliation(date, tenantId);
  }

  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Process refund for a transaction' })
  @ApiResponse({ status: 200, description: 'Refund initiated' })
  async processRefund(@Body() dto: RefundRequestDto, @Request() req: any) {
    return this.promptPayService.processRefund(dto, req.user?.id);
  }
}
