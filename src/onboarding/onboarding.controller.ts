import { Controller, Post, Body, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OnboardingService } from './onboarding.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AcceptDpaDto } from './dto/accept-dpa.dto';

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
    @Body('trialDays') trialDays?: number,
  ) {
    return this.onboardingService.registerHotel(createTenantDto, trialDays || 14);
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
  async acceptDpa(
    @Body() dto: AcceptDpaDto,
    @CurrentUser() user: any,
    @Req() request: Request,
  ) {
    return this.onboardingService.acceptDpa(user.tenantId, user.userId ?? user.id, dto, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
