import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { TrueMoneyService } from './truemoney.service';
import { InitiateTrueMoneyDto, TrueMoneyCallbackDto } from './dto/truemoney.dto';

@ApiTags('TrueMoney Payments')
@Controller('api/v1/truemoney')
export class TrueMoneyController {
  constructor(private readonly trueMoneyService: TrueMoneyService) {}

  /**
   * เริ่มต้นชำระเงินผ่าน TrueMoney Wallet
   * Returns redirectUrl → frontend redirect ลูกค้าไปหน้า TrueMoney
   */
  @UseGuards(JwtAuthGuard)
  @Post('initiate')
  @ApiOperation({ summary: 'เริ่มต้นชำระเงิน TrueMoney Wallet (via 2C2P)' })
  @ApiResponse({ status: 201, description: 'ได้รับ redirectUrl เรียบร้อยแล้ว' })
  initiate(
    @Req() req: Request & { user: { tenantId: string } },
    @Body() dto: InitiateTrueMoneyDto,
  ) {
    return this.trueMoneyService.initiate(req.user.tenantId, dto);
  }

  /**
   * Callback จาก 2C2P หลังลูกค้าชำระเงิน
   * (2C2P จะ POST มาที่ endpoint นี้ — ไม่ต้องใช้ JWT)
   */
  @Post('callback')
  @Public()
  @ApiOperation({ summary: '2C2P Payment Callback (signature-verified)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Invalid or missing 2C2P signature' })
  async callback(@Body() dto: TrueMoneyCallbackDto) {
    await this.trueMoneyService.handleCallback(dto);
    return { received: true };
  }

  /**
   * ตรวจสอบสถานะ transaction
   */
  @UseGuards(JwtAuthGuard)
  @Get('transactions/:merchantOrderId')
  @ApiOperation({ summary: 'ตรวจสอบสถานะ TrueMoney Transaction' })
  getStatus(
    @Req() req: Request & { user: { tenantId: string } },
    @Param('merchantOrderId') merchantOrderId: string,
  ) {
    return this.trueMoneyService.getTransactionStatus(req.user.tenantId, merchantOrderId);
  }
}
