import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AR_WRITE_ROLES, AccountingAccess } from '@/modules/accounting/accounting-access.decorator';
import { ArStatementsService } from './ar-statements.service';
import { QueryArStatementCustomersDto, QueryArStatementDto } from './dto/query-ar-statement.dto';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

/** ใบแจ้งยอด (Statement) ลูกค้า — อ่านอย่างเดียว (GET → ACCOUNTING_READ_ROLES) */
@ApiTags('Accounting - AR Statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard, RolesGuard)
@AccountingAccess(AR_WRITE_ROLES)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ar-statements', version: '1' })
export class ArStatementsController {
  constructor(private readonly service: ArStatementsService) {}

  @Get('customers')
  @ApiOperation({ summary: 'รายชื่อลูกค้าที่มียอดค้าง (แขก / บริษัท City Ledger) สำหรับเลือกออก Statement' })
  async customers(@CurrentUser() user: JwtPayload, @Query() query: QueryArStatementCustomersDto) {
    const data = await this.service.listCustomers(user.tenantId, query);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({
    summary: 'ใบแจ้งยอดลูกค้า: ยอดยกมา / ใบแจ้งหนี้ / ใบลดหนี้ / รับชำระ (รวม WHT) / ยอดคงเหลือ / อายุหนี้',
  })
  async statement(@CurrentUser() user: JwtPayload, @Query() query: QueryArStatementDto) {
    const data = await this.service.getStatement(user.tenantId, query);
    return { success: true, data };
  }
}
