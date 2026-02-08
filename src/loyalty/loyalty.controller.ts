import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { InviteReferralDto } from './dto/loyalty.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('loyalty/points')
  async getPoints(@CurrentUser() user: { tenantId: string }) {
    return this.loyaltyService.getPoints(user.tenantId);
  }

  @Post('referral/invite')
  async inviteReferral(
    @CurrentUser() user: { userId: string; tenantId: string },
    @Body() data: InviteReferralDto,
  ) {
    return this.loyaltyService.inviteReferral(user.userId, user.tenantId, data);
  }
}
