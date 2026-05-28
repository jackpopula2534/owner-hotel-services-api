import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GuestFolioService } from './guest-folio.service';
import { CreateFolioChargeDto } from './dto/create-folio-charge.dto';
import { CreateFolioPaymentDto } from './dto/create-folio-payment.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Guest Folio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/guest-folio', version: '1' })
export class GuestFolioController {
  constructor(private readonly service: GuestFolioService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการ Guest Folio ทั้งหมด' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.service.findAll(user.tenantId, propertyId, status);
    return { success: true, ...result };
  }

  @Get('booking/:bookingId')
  @ApiOperation({ summary: 'หา Folio จาก Booking ID' })
  async findByBooking(
    @CurrentUser() user: JwtPayload,
    @Param('bookingId') bookingId: string,
  ) {
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
