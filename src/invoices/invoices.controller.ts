import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('invoices')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'invoices', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @ApiOperation({ summary: 'Create invoice' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  create(@Body() createInvoiceDto: CreateInvoiceDto) {
    return this.invoicesService.create(createInvoiceDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all invoices' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findAll(@CurrentUser() user: { tenantId?: string }) {
    return this.invoicesService.findAll(user?.tenantId);
  }

  @Get('outstanding')
  @ApiOperation({
    summary: "Get the current tenant's outstanding (unpaid) subscription invoices",
  })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async findOutstanding(@CurrentUser() user: { tenantId?: string }) {
    const invoices = user?.tenantId
      ? await this.invoicesService.findOutstandingSubscriptionInvoices(user.tenantId)
      : [];
    return { success: true, data: invoices, meta: { total: invoices.length } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.invoicesService.findOne(id, user?.tenantId);
  }

  @Get('tenant/:tenantId')
  @ApiOperation({ summary: 'Get invoices by tenant ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findByTenantId(@Param('tenantId') tenantId: string) {
    return this.invoicesService.findByTenantId(tenantId);
  }

  @Post(':id/void')
  @ApiOperation({
    summary: 'Void (cancel) an outstanding subscription invoice for the current tenant',
  })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async voidInvoice(
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    const invoice = await this.invoicesService.voidInvoice(id, dto.reason, user?.tenantId);
    return { success: true, data: invoice };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update invoice' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateInvoiceDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete invoice' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.invoicesService.remove(id, user?.tenantId);
  }
}
