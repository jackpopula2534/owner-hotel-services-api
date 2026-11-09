import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

/**
 * Integration Hub — lets a tenant enable/disable connections between the
 * Sub-Systems they are entitled to (e.g. ครัว → คลัง auto-deduct).
 */
@ApiTags('integrations')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'integrations', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @Roles('tenant_admin', 'manager', 'platform_admin')
  @ApiOperation({ summary: 'List sub-system integrations with availability + on/off state' })
  @ApiResponse({ status: 200, description: 'Integration list for the current tenant' })
  async list(@CurrentUser() user?: { tenantId?: string }) {
    const data = await this.integrationsService.list(user?.tenantId ?? '');
    return { success: true, data };
  }

  @Patch(':key')
  @Roles('tenant_admin', 'manager', 'platform_admin')
  @ApiOperation({ summary: 'Enable or disable an integration for the current tenant' })
  @ApiParam({ name: 'key', example: 'restaurant-inventory-autodeduct' })
  @ApiResponse({ status: 200, description: 'Updated integration status' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateIntegrationDto,
    @CurrentUser() user?: { tenantId?: string },
  ) {
    const data = await this.integrationsService.setEnabled(
      user?.tenantId ?? '',
      key,
      dto.enabled,
    );
    return { success: true, data };
  }
}
