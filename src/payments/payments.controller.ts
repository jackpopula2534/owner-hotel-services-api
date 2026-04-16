import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ApprovePaymentDto } from './dto/approve-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'payments', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create payment' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  create(@Body() createPaymentDto: CreatePaymentDto, @CurrentUser() user: { tenantId?: string }) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payments' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.paymentsService.findAll(user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.paymentsService.findOne(id, user?.tenantId);
  }

  @Get('invoice/:invoiceId')
  @ApiOperation({ summary: 'Get payments by invoice ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findByInvoiceId(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.paymentsService.findByInvoiceId(invoiceId, user?.tenantId);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  approve(
    @Param('id') id: string,
    @Body() approvePaymentDto: ApprovePaymentDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.paymentsService.approvePayment(id, approvePaymentDto.adminId, user?.tenantId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  reject(
    @Param('id') id: string,
    @Body() approvePaymentDto: ApprovePaymentDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.paymentsService.rejectPayment(id, approvePaymentDto.adminId, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}
