import { withPaginationMeta } from '@/common/utils/pagination.util';
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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GuestFolioService } from './guest-folio.service';
import { CreateFolioChargeDto } from './dto/create-folio-charge.dto';
import { CreateFolioPaymentDto } from './dto/create-folio-payment.dto';
import { TransferCityLedgerDto } from './dto/transfer-city-ledger.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { AR_WRITE_ROLES, AccountingAccess } from '@/modules/accounting/accounting-access.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Guest Folio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard, RolesGuard)
@AccountingAccess(AR_WRITE_ROLES)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/guest-folio', version: '1' })
export class GuestFolioController {
  constructor(private readonly service: GuestFolioService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการ Guest Folio ทั้งหมด' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'CLOSED', 'PENDING', 'VOID'] })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !['OPEN', 'CLOSED', 'PENDING', 'VOID'].includes(status)) {
      throw new BadRequestException(`Invalid folio status: ${status}`);
    }
    const result = await this.service.findAll(user.tenantId, {
      propertyId,
      status,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return withPaginationMeta(result);
  }

  @Get('summary')
  @ApiOperation({ summary: 'สรุป Guest Ledger: folio เปิด/รอชำระ และยอดค้าง' })
  @ApiQuery({ name: 'propertyId', required: false })
  async getSummary(@CurrentUser() user: JwtPayload, @Query('propertyId') propertyId?: string) {
    const data = await this.service.getSummary(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'หา Folio จาก Booking ID' })
  async findByBooking(@CurrentUser() user: JwtPayload, @Param('bookingId') bookingId: string) {
    const data = await this.service.findByBooking(bookingId, user.tenantId);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู Folio รายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post('charges')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'เพิ่ม Charge ลงใน Folio' })
  async addCharge(@CurrentUser() user: JwtPayload, @Body() dto: CreateFolioChargeDto) {
    const data = await this.service.addCharge(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'บันทึกการชำระเงินลงใน Folio' })
  async addPayment(@CurrentUser() user: JwtPayload, @Body() dto: CreateFolioPaymentDto) {
    const data = await this.service.addPayment(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Post(':id/transfer-city-ledger')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'โอนยอดคงค้างเข้า City Ledger (Dr 1104 / Cr 1103)' })
  async transferToCityLedger(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: TransferCityLedgerDto,
  ) {
    const data = await this.service.transferToCityLedger(id, dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'ปิด Folio (ต้องมี balance = 0)' })
  async close(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.close(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch('charges/:chargeId/reverse')
  @ApiOperation({ summary: 'กลับรายการ Charge' })
  async reverseCharge(@CurrentUser() user: JwtPayload, @Param('chargeId') chargeId: string) {
    const data = await this.service.reverseCharge(chargeId, user.tenantId, user.sub);
    return { success: true, data };
  }
}
