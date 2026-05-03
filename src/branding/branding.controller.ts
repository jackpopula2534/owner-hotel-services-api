import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BrandingService, UpsertBrandingInput } from './branding.service';

@ApiTags('Branding (White-label)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'branding', version: '1' })
export class BrandingController {
  constructor(private readonly service: BrandingService) {}

  @Get()
  @ApiOperation({ summary: 'Get branding config for the active tenant' })
  async get(@CurrentUser() user: any) {
    return (await this.service.getForTenant(user.tenant_id)) || {};
  }

  @Patch()
  @ApiOperation({ summary: 'Update branding (logo / colors / sender)' })
  async upsert(
    @CurrentUser() user: any,
    @Body() body: Omit<UpsertBrandingInput, 'tenantId'>,
  ) {
    return this.service.upsert({ ...body, tenantId: user.tenant_id });
  }

  @Post('domain')
  @ApiOperation({ summary: 'Request a custom domain (returns DNS instructions)' })
  async requestDomain(
    @CurrentUser() user: any,
    @Body() body: { domain: string },
  ) {
    return this.service.requestCustomDomain(user.tenant_id, body.domain);
  }
}
