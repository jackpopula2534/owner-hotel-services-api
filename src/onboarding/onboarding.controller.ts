import { Controller, Post, Body, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreateTenantDto } from '../tenants/dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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
}


