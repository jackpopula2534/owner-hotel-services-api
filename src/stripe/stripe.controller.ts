import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { StripeService } from './stripe.service';
import { ConfirmPaymentIntentDto, CreatePaymentIntentDto } from './dto/stripe.dto';

@ApiTags('Stripe Payments')
@Controller('api/v1/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * สร้าง PaymentIntent — frontend นำ clientSecret ไปใช้กับ Stripe.js
   */
  @UseGuards(JwtAuthGuard)
  @Post('payment-intents')
  @ApiOperation({ summary: 'สร้าง Stripe PaymentIntent' })
  @ApiResponse({ status: 201, description: 'PaymentIntent สร้างสำเร็จ' })
  createPaymentIntent(
    @Req() req: Request & { user: { tenantId: string } },
    @Body() dto: CreatePaymentIntentDto,
  ) {
    return this.stripeService.createPaymentIntent(req.user.tenantId, dto);
  }

  /**
   * ดูสถานะ PaymentIntent (sync กับ Stripe)
   */
  @UseGuards(JwtAuthGuard)
  @Get('payment-intents/:id')
  @ApiOperation({ summary: 'ตรวจสอบสถานะ PaymentIntent' })
  getPaymentIntentStatus(
    @Req() req: Request & { user: { tenantId: string } },
    @Param('id') id: string,
  ) {
    return this.stripeService.getPaymentIntentStatus(req.user.tenantId, id);
  }

  /**
   * Webhook endpoint — รับ event จาก Stripe
   * ต้องใช้ raw body (ไม่ผ่าน JSON parser) เพื่อ verify signature
   */
  @Post('webhook')
  @ApiOperation({ summary: 'Stripe Webhook Handler' })
  @ApiResponse({ status: 200 })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      return { received: false, error: 'No raw body' };
    }
    await this.stripeService.handleWebhook(rawBody, signature);
    return { received: true };
  }
}
