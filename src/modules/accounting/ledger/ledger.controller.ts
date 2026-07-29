import { Controller, Get, Post, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Ledger & Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ledger', version: '1' })
export class LedgerController {
  constructor(private readonly service: LedgerService) {}

  @Get('trial-balance')
  @ApiOperation({ summary: 'งบทดลอง (Trial Balance)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true, type: Number })
  @ApiQuery({
    name: 'fiscalPeriod',
    required: false,
    type: Number,
    description: 'ถ้าไม่ระบุจะใช้เดือนปัจจุบัน',
  })
  async getTrialBalance(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('fiscalYear', ParseIntPipe) fiscalYear: number,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ) {
    const period = fiscalPeriod ? parseInt(fiscalPeriod, 10) : new Date().getMonth() + 1;
    const data = await this.service.getTrialBalance(user.tenantId, propertyId, fiscalYear, period);
    return { success: true, data };
  }

  @Post('rebuild-balances')
  @ApiOperation({
    summary: 'สร้างยอดคงเหลือรายบัญชีใหม่จาก JE ที่ POSTED (ซ่อมข้อมูลเก่าที่ยอดไม่เข้างบทดลอง)',
  })
  @ApiQuery({ name: 'propertyId', required: false, description: 'ไม่ระบุ = ทุก property ของ tenant' })
  async rebuildBalances(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
  ) {
    const data = await this.service.rebuildLedgerBalances(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('account-ledger')
  @ApiOperation({ summary: 'บัญชีแยกประเภท (Account Ledger / T-Account)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'accountId', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true, type: Number })
  @ApiQuery({ name: 'periodFrom', required: true, type: Number })
  @ApiQuery({ name: 'periodTo', required: true, type: Number })
  async getAccountLedger(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('accountId') accountId: string,
    @Query('fiscalYear', ParseIntPipe) fiscalYear: number,
    @Query('periodFrom', ParseIntPipe) periodFrom: number,
    @Query('periodTo', ParseIntPipe) periodTo: number,
  ) {
    const data = await this.service.getAccountLedger(
      user.tenantId,
      propertyId,
      accountId,
      fiscalYear,
      periodFrom,
      periodTo,
    );
    return { success: true, data };
  }

  @Get('profit-and-loss')
  @ApiOperation({ summary: 'งบกำไรขาดทุน (P&L Statement)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true, type: Number })
  @ApiQuery({ name: 'fiscalPeriod', required: false, type: Number })
  async getProfitAndLoss(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('fiscalYear', ParseIntPipe) fiscalYear: number,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ) {
    const data = await this.service.getProfitAndLoss(
      user.tenantId,
      propertyId,
      fiscalYear,
      fiscalPeriod ? parseInt(fiscalPeriod, 10) : undefined,
    );
    return { success: true, data };
  }

  @Get('balance-sheet')
  @ApiOperation({ summary: 'งบดุล (Balance Sheet)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'fiscalYear', required: true, type: Number })
  @ApiQuery({ name: 'fiscalPeriod', required: false, type: Number })
  async getBalanceSheet(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('fiscalYear', ParseIntPipe) fiscalYear: number,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ) {
    const data = await this.service.getBalanceSheet(
      user.tenantId,
      propertyId,
      fiscalYear,
      fiscalPeriod ? parseInt(fiscalPeriod, 10) : undefined,
    );
    return { success: true, data };
  }
}
