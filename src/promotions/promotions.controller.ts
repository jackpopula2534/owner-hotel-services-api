import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { ApplyCouponDto } from './dto/promotions.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('active')
  @UseGuards(JwtAuthGuard)
  async getActivePromotions(@CurrentUser() user: any, @Query('segment') segment?: string) {
    return this.promotionsService.getActivePromotions(segment || user.segment);
  }

  @Post('apply-coupon')
  @UseGuards(JwtAuthGuard)
  async applyCoupon(@Body() data: ApplyCouponDto) {
    return this.promotionsService.applyCoupon(data.code);
  }
}
