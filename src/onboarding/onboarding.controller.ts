import { Controller, Post, Body, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OnboardingService } from './onboarding.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AcceptDpaDto } from './dto/accept-dpa.dto';

/** Free-trial length for self-service sign-up. Server policy — not client input. */
export const ONBOARDING_TRIAL_DAYS = 14;

@Controller('onboarding')
@SkipSubscriptionCheck()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * 1️⃣ Owner สมัครใช้งาน
   * POST /onboarding/register
   */
  @Post('register')
  async registerHotel(
    @Body() createTenantDto: CreateTenantDto,
    @Body('system') system?: string,
  ) {
    // Trial length is a server-side policy, never a client choice: this route is
    // public, and `trialDays: 36500` used to buy a 100-year free trial
    // (audit 2026-11-09 M2). Platform admins extend trials via admin-approval.
    return this.onboardingService.registerHotel(
      createTenantDto,
      ONBOARDING_TRIAL_DAYS,
      system?.toUpperCase() === 'CAMP' ? 'CAMP' : 'HOTEL',
    );
  }

  /**
   * ตรวจสอบ trial status
   * GET /onboarding/tenant/:tenantId/trial-status
   */
  @Get('tenant/:tenantId/trial-status')
  async getTrialStatus(@Param('tenantId') tenantId: string) {
    return this.onboardingService.getTrialStatus(tenantId);
  }

  @Get('progress')
  @UseGuards(JwtAuthGuard)
  async getProgress(@CurrentUser() user: any) {
    return this.onboardingService.getProgress(user.tenantId);
  }

  @Patch('step/:id')
  @UseGuards(JwtAuthGuard)
  async updateStep(
    @Param('id') id: string,
    @Body('isCompleted') isCompleted: boolean,
    @CurrentUser() user: any,
  ) {
    return this.onboardingService.updateStep(user.tenantId, id, isCompleted);
  }

  @Get('dpa/status')
  @UseGuards(JwtAuthGuard)
  async getDpaStatus(@CurrentUser() user: any) {
    return this.onboardingService.getDpaStatus(user.tenantId);
  }

  @Post('dpa/accept')
  @UseGuards(JwtAuthGuard)
  async acceptDpa(@Body() dto: AcceptDpaDto, @CurrentUser() user: any, @Req() request: Request) {
    return this.onboardingService.acceptDpa(user.tenantId, user.userId ?? user.id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
