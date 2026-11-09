import { AllowSystems } from '../../../common/decorators/allow-systems.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  ACCOUNTING_WRITE_ROLES,
  AccountingAccess,
} from '@/modules/accounting/accounting-access.decorator';
import { BankStatementsService } from './bank-statements.service';
import {
  ImportBankStatementDto,
  LinkReceiptDto,
  QueryBankStatementDto,
  SetStatementLineStatusDto,
} from './dto/import-bank-statement.dto';

interface JwtPayload {
  sub: string;
  tenantId: string;
}

@ApiTags('Accounting - Bank Statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard, RolesGuard)
@AccountingAccess(ACCOUNTING_WRITE_ROLES)
@RequireAddon('ACCOUNTING_MODULE')
// Accounting Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('accounting')
@Controller({ path: 'accounting/bank-statements', version: '1' })
export class BankStatementsController {
  constructor(private readonly service: BankStatementsService) {}

  @Get('bank-accounts')
  @ApiOperation({ summary: 'บัญชีเงินฝากธนาคาร (1102*) ที่นำเข้า Statement ได้' })
  async bankAccounts(@CurrentUser() user: JwtPayload) {
    return { success: true, data: await this.service.bankAccounts(user.tenantId) };
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'นำเข้ารายการ Statement (กันซ้ำด้วยลายนิ้วมือแถว) — ใช้ร่วมกันระหว่าง AR และกระทบยอด',
  })
  @ApiResponse({ status: 201, description: 'คืนทุกแถวของไฟล์พร้อมสถานะ' })
  async import(@CurrentUser() user: JwtPayload, @Body() dto: ImportBankStatementDto) {
    return { success: true, data: await this.service.import(dto, user.tenantId, user.sub) };
  }

  @Get()
  @ApiOperation({ summary: 'รายการ Statement ที่นำเข้าแล้ว' })
  async list(@CurrentUser() user: JwtPayload, @Query() q: QueryBankStatementDto) {
    return { success: true, data: await this.service.list(user.tenantId, q) };
  }

  @Patch(':id/link-receipt')
  @ApiOperation({ summary: 'ผูกรายการเงินเข้ากับใบเสร็จรับชำระที่สร้างจากรายการนี้' })
  async linkReceipt(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkReceiptDto,
  ) {
    return {
      success: true,
      data: await this.service.linkReceipt(id, dto.arReceiptId, user.tenantId),
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'ข้ามรายการ / เปิดกลับมารอจับคู่' })
  async setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatementLineStatusDto,
  ) {
    return { success: true, data: await this.service.setStatus(id, dto.status, user.tenantId) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบรายการ Statement ที่ยังไม่จับคู่' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.remove(id, user.tenantId) };
  }
}
