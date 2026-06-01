import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArInvoicesService } from './ar-invoices.service';
import { CreateArInvoiceDto } from './dto/create-ar-invoice.dto';
import { QueryArInvoiceDto } from './dto/query-ar-invoice.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

class VoidInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - AR Invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ar-invoices', version: '1' })
export class ArInvoicesController {
  constructor(private readonly service: ArInvoicesService) {}

  @Get('aging')
  @ApiOperation({ summary: 'AR Aging Report' })
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

  @Get('sequence-audit')
  @ApiOperation({ summary: 'ตรวจเลขรันใบกำกับภาษีว่ามีเลขขาด/ซ้ำหรือไม่ (LEGAL-03)' })
  @ApiQuery({ name: 'yearMonth', required: false, description: 'e.g. 202605' })
  async sequenceAudit(@CurrentUser() user: JwtPayload, @Query('yearMonth') yearMonth?: string) {
    const data = await this.service.detectSequenceGaps(user.tenantId, { yearMonth });
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'ดูรายการ AR Invoice ทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryArInvoiceDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู AR Invoice รายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้าง AR Invoice' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateArInvoiceDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/issue')
  @ApiOperation({ summary: 'ออก Invoice (DRAFT → ISSUED)' })
  async issue(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.issue(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/void')
  @ApiOperation({ summary: 'ยกเลิก Invoice' })
  async void(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    const data = await this.service.void(id, user.tenantId, user.sub, dto.reason);
    return { success: true, data };
  }
}
