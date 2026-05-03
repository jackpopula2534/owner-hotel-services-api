import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  CouponsService,
  CreateCouponInput,
  PreviewCouponInput,
  UpdateCouponInput,
  ValidateCouponInput,
  RedeemCouponInput,
} from './coupons.service';

@ApiTags('Coupons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'coupons', version: '1' })
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  // ── Admin endpoints ──
  @Post('admin')
  @ApiOperation({ summary: '[Admin] Create a coupon' })
  async create(@Body() body: CreateCouponInput) {
    return this.couponsService.create(body);
  }

  @Get('admin')
  @ApiOperation({ summary: '[Admin] List coupons' })
  async list(@Query('activeOnly') activeOnly?: string) {
    return this.couponsService.list({ activeOnly: activeOnly === 'true' });
  }

  @Patch('admin/:id/deactivate')
  @ApiOperation({ summary: '[Admin] Deactivate a coupon' })
  async deactivate(@Param('id') id: string) {
    return this.couponsService.deactivate(id);
  }

  @Patch('admin/:id')
  @ApiOperation({ summary: '[Admin] Update an existing coupon' })
  async update(@Param('id') id: string, @Body() body: UpdateCouponInput) {
    return this.couponsService.update(id, body);
  }

  @Get('admin/:id/stats')
  @ApiOperation({ summary: '[Admin] Coupon redemption stats' })
  async stats(@Param('id') id: string) {
    return this.couponsService.getStats(id);
  }

  // ── Public endpoints (used by pricing/checkout pages before login) ──
  @Public()
  @Post('preview')
  @ApiOperation({
    summary:
      'Preview a coupon (public). Validates code/limit/dates only — does not bind to a tenant.',
  })
  async preview(@Body() body: PreviewCouponInput) {
    return this.couponsService.preview(body);
  }

  @Public()
  @Get('public/active')
  @ApiOperation({
    summary:
      'List active, non-expired coupons that admins explicitly marked as showcaseable on the pricing page.',
  })
  async listPublic(@Query('planId') planId?: string) {
    return this.couponsService.listPublic({ planId });
  }

  @Public()
  @Get('public/featured')
  @ApiOperation({
    summary:
      'List coupons currently inside their featured banner window — used by the pricing page banner.',
  })
  async listFeatured(@Query('planId') planId?: string) {
    return this.couponsService.listFeatured({ planId });
  }

  // ── Tenant endpoints ──
  @Post('validate')
  @ApiOperation({ summary: 'Validate a coupon code without redeeming it' })
  async validate(
    @CurrentUser() user: any,
    @Body() body: Omit<ValidateCouponInput, 'tenantId'>,
  ) {
    return this.couponsService.validate({ ...body, tenantId: user.tenant_id });
  }

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem a coupon (atomically applies discount)' })
  async redeem(
    @CurrentUser() user: any,
    @Body() body: Omit<RedeemCouponInput, 'tenantId'>,
  ) {
    return this.couponsService.redeem({ ...body, tenantId: user.tenant_id });
  }
}
