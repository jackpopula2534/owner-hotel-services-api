import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LoyaltyService } from './loyalty.service';
import {
  AdjustPointsDto,
  EarnPointsDto,
  InviteReferralDto,
  RedeemPointsDto,
} from './dto/loyalty.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('loyalty')
@ApiBearerAuth('JWT-auth')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  // Tenant-level default account (legacy endpoint)
  @Get('loyalty/points')
  @ApiOperation({ summary: 'Get tenant default loyalty point balance' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user')
  async getPoints(@CurrentUser() user: { tenantId: string }) {
    return this.loyaltyService.getPoints(user.tenantId);
  }

  // Per-guest balance
  @Get('loyalty/guests/:guestId')
  @ApiOperation({ summary: 'Get loyalty balance for a specific guest' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'staff',
    'receptionist',
    'crm_agent',
    'crm_manager',
  )
  async getGuestBalance(
    @Param('guestId') guestId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.loyaltyService.getGuestBalance(user.tenantId, guestId);
  }

  @Get('loyalty/guests/:guestId/history')
  @ApiOperation({ summary: 'Get loyalty transaction history for a guest' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_agent', 'crm_manager')
  async getGuestHistory(
    @Param('guestId') guestId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.loyaltyService.getGuestHistory(
      user.tenantId,
      guestId,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Post('loyalty/earn')
  @ApiOperation({ summary: 'Manually award loyalty points to a guest' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async earn(@Body() dto: EarnPointsDto, @CurrentUser() user: { tenantId: string }) {
    return this.loyaltyService.earnFromDto(user.tenantId, dto);
  }

  @Post('loyalty/redeem')
  @ApiOperation({ summary: 'Redeem loyalty points' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'crm_manager',
    'crm_agent',
    'receptionist',
  )
  async redeem(@Body() dto: RedeemPointsDto, @CurrentUser() user: { tenantId: string }) {
    return this.loyaltyService.redeem(user.tenantId, dto);
  }

  @Post('loyalty/adjust')
  @ApiOperation({ summary: 'Admin-only point adjustment with audit reason' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async adjust(@Body() dto: AdjustPointsDto, @CurrentUser() user: { tenantId: string }) {
    return this.loyaltyService.adjust(user.tenantId, dto);
  }

  @Post('referral/invite')
  @ApiOperation({ summary: 'Invite a friend for referral reward' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user')
  async inviteReferral(
    @CurrentUser() user: { userId: string; tenantId: string },
    @Body() data: InviteReferralDto,
  ) {
    return this.loyaltyService.inviteReferral(user.userId, user.tenantId, data);
  }
}
