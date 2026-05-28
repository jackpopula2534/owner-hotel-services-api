import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApInvoicesService } from './ap-invoices.service';
import { CreateApInvoiceDto } from './dto/create-ap-invoice.dto';
import { QueryApInvoiceDto } from './dto/query-ap-invoice.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

class VoidApInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - AP Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ap-invoices', version: '1' })
export class ApInvoicesController {
  constructor(private readonly service: ApInvoicesService) {}

  @Get('aging')
  @ApiOperation({ summary: 'AP Aging Report' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'asOfDate', required: false })
  async getAging(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    const data = await this.service.getAging(user.tenantId, propertyId, asOfDate);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'ดูรายการ AP Invoice ทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryApInvoiceDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู AP Invoice รายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้าง AP Invoice' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateApInvoiceDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'อนุมัติ AP Invoice (PENDING → APPROVED)' })
  async approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.approve(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/void')
  @ApiOperation({ summary: 'ยกเลิก AP Invoice' })
  async void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VoidApInvoiceDto,
  ) {
    const data = await this.service.void(id, user.tenantId, user.sub, dto.reason);
    return { success: true, data };
  }
}
