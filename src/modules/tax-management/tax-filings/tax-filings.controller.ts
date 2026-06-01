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
import { TaxFilingsService } from './tax-filings.service';
import { CreateTaxFilingDto, TaxFilingType } from './dto/create-tax-filing.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsOptional, IsEnum, IsString, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class QueryTaxFilingDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ enum: TaxFilingType })
  @IsOptional()
  @IsEnum(TaxFilingType)
  filingType?: TaxFilingType;
  @ApiPropertyOptional() @IsOptional() @IsString() period?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

class GenerateVatPP30Dto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() period?: string;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Tax Filings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/tax-filings', version: '1' })
export class TaxFilingsController {
  constructor(private readonly service: TaxFilingsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการแบบยื่นภาษีทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryTaxFilingDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูแบบยื่นภาษีรายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างแบบยื่นภาษี' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTaxFilingDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Post('generate/vat-pp30')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Auto-generate ภ.พ.30 จาก AR/AP Invoices ในงวดนั้น' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, description: 'รูปแบบ YYYY-MM เช่น 2025-01' })
  async generateVatPP30(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ) {
    const data = await this.service.generateVatPP30(user.tenantId, propertyId, period);
    return { success: true, data };
  }

  @Patch(':id/submit')
  @ApiOperation({ summary: 'ยื่นแบบภาษี (DRAFT/READY → FILED)' })
  async submit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.submit(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/mark-paid')
  @ApiOperation({ summary: 'บันทึกการชำระภาษี (FILED → PAID)' })
  async markPaid(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.markPaid(id, user.tenantId, user.sub);
    return { success: true, data };
  }
}
