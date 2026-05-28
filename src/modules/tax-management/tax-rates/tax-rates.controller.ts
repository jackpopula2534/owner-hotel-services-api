import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TaxRatesService } from './tax-rates.service';
import { CreateTaxRateDto, TaxType } from './dto/create-tax-rate.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Tax Rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/tax-rates', version: '1' })
export class TaxRatesController {
  constructor(private readonly service: TaxRatesService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการอัตราภาษีทั้งหมด' })
  @ApiQuery({ name: 'type', required: false, enum: TaxType })
  async findAll(@CurrentUser() user: JwtPayload, @Query('type') type?: TaxType) {
    const result = await this.service.findAll(user.tenantId, type);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูอัตราภาษีรายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างอัตราภาษีใหม่' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTaxRateDto) {
    const data = await this.service.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขอัตราภาษี' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTaxRateDto>,
  ) {
    const data = await this.service.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Post('seed-defaults')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Seed อัตราภาษีมาตรฐานไทย (VAT 7%, WHT ต่างๆ)' })
  async seedDefaults(@CurrentUser() user: JwtPayload) {
    const data = await this.service.seedDefaults(user.tenantId);
    return { success: true, data };
  }
}
