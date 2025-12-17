import {
  Controller,
  Get,
  Param,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { FeatureAccessService } from './feature-access.service';

@Controller('feature-access')
export class FeatureAccessController {
  constructor(private readonly featureAccessService: FeatureAccessService) {}

  /**
   * ตรวจสอบว่า tenant มีสิทธิ์ใช้ feature หรือไม่
   * GET /feature-access/check?tenantId=xxx&featureCode=ota_booking
   */
  @Get('check')
  async checkFeatureAccess(
    @Query('tenantId') tenantId: string,
    @Query('featureCode') featureCode: string,
  ) {
    if (!tenantId || !featureCode) {
      throw new ForbiddenException('tenantId and featureCode are required');
    }

    return this.featureAccessService.checkFeatureAccess(tenantId, featureCode);
  }

  /**
   * ดึงข้อมูล features ทั้งหมดที่ tenant มีสิทธิ์ใช้
   * GET /feature-access/tenant/:tenantId/features
   */
  @Get('tenant/:tenantId/features')
  async getTenantFeatures(@Param('tenantId') tenantId: string) {
    return this.featureAccessService.getTenantFeatures(tenantId);
  }

  /**
   * ตรวจสอบ subscription status และ validity
   * GET /feature-access/tenant/:tenantId/subscription-status
   */
  @Get('tenant/:tenantId/subscription-status')
  async getSubscriptionStatus(@Param('tenantId') tenantId: string) {
    return this.featureAccessService.getSubscriptionStatus(tenantId);
  }
}

