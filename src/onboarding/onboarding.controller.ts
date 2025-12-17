import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';

@Controller('onboarding')
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
    return this.onboardingService.registerHotel(
      createTenantDto,
      trialDays || 14,
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
}


