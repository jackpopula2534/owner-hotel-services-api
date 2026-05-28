import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BankReconciliationService } from './bank-reconciliation.service';
import { CreateBankReconDto } from './dto/create-bank-recon.dto';
import { CreateReconLineDto } from './dto/create-recon-line.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Bank Reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/bank-reconciliation', version: '1' })
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการกระทบยอดธนาคารทั้งหมด' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'bankAccountId', required: false })
  @ApiQuery({ name: 'period', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('bankAccountId') bankAccountId?: string,
    @Query('period') period?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.findAll(user.tenantId, {
      propertyId, bankAccountId, period, status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return { success: true, ...data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดการกระทบยอด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างการกระทบยอดธนาคาร' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBankReconDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Post('lines')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'เพิ่มรายการกระทบยอด' })
  async addLine(@CurrentUser() user: JwtPayload, @Body() dto: CreateReconLineDto) {
    const data = await this.service.addLine(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch('lines/:lineId/match')
  @ApiOperation({ summary: 'Toggle กระทบยอด / ยกเลิกกระทบยอด' })
  async matchLine(@CurrentUser() user: JwtPayload, @Param('lineId') lineId: string) {
    const data = await this.service.matchLine(lineId, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'อนุมัติการกระทบยอด' })
  async approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.approve(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'สรุปการกระทบยอด (matched vs unmatched)' })
  async getSummary(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.getSummary(id, user.tenantId);
    return { success: true, data };
  }
}
