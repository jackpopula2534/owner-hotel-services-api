import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonService, AddonStatus } from './addon.service';

@ApiTags('Add-ons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addons')
export class AddonController {
  constructor(private readonly addonService: AddonService) {}

  @ApiOperation({ summary: 'Get active add-ons for the current tenant' })
  @ApiResponse({
    status: 200,
    description: 'List of active module add-ons for the tenant',
    schema: {
      example: {
        success: true,
        data: [
          {
            code: 'HR_MODULE',
            name: 'HR Module',
            isActive: true,
            expiresAt: null,
          },
        ],
      },
    },
  })
  @Get('status')
  async getAddonStatus(
    @Request() req: { user: { tenantId: string } },
  ): Promise<{ success: true; data: AddonStatus[] }> {
    const addons = await this.addonService.getActiveAddons(req.user.tenantId);
    return { success: true, data: addons };
  }
}
