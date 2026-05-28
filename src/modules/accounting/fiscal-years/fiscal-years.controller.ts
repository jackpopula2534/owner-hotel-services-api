import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FiscalYearsService } from './fiscal-years.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Fiscal Years')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/fiscal-years', version: '1' })
export class FiscalYearsController {
  constructor(private readonly service: FiscalYearsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูปีบัญชีทั้งหมด' })
  @ApiQuery({ name: 'propertyId', required: false })
  async findAll(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId?: string) {
    const data = await this.service.findAll(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('current')
  @ApiOperation({ summary: 'ดูปีบัญชีปัจจุบัน' })
  @ApiQuery({ name: 'propertyId', required: true })
  async findCurrent(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId: string) {
    const data = await this.service.findCurrent(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูปีบัญชีตาม ID' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างปีบัญชีใหม่' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFiscalYearDto) {
    const data = await this.service.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'ปิดปีบัญชี' })
  async close(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.close(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/lock')
  @ApiOperation({ summary: 'ล็อคปีบัญชี (ห้ามแก้ไขอีก)' })
  async lock(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.lock(id, user.tenantId, user.sub);
    return { success: true, data };
  }
}
