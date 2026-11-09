import { BadRequestException, Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { QUOTA_ADDONS, isQuotaAddon } from './addon-quota.constants';
import { AddonQuotaService, AddonQuotaStatus } from './addon-quota.service';

/** /api/v1/addon-quotas — tenant ดูโควตาคงเหลือของตัวเอง (ใช้ในหน้า wizard 3D) */
@ApiTags('Add-on Quotas')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'addon-quotas', version: '1' })
@UseGuards(JwtAuthGuard)
export class AddonQuotaController {
  constructor(private readonly service: AddonQuotaService) {}

  @Get(':addonCode/status')
  @ApiOperation({ summary: 'Current tenant quota status for an add-on' })
  @ApiParam({ name: 'addonCode', enum: QUOTA_ADDONS })
  @ApiResponse({
    status: 200,
    description: 'Entitlement, included/used/remaining, overage pricing',
  })
  getStatus(
    @Param('addonCode') addonCode: string,
    @Request() req: { user?: { tenantId?: string } },
  ): Promise<AddonQuotaStatus> {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new BadRequestException('ต้องเข้าสู่ระบบด้วยบัญชีของกิจการ');
    if (!isQuotaAddon(addonCode))
      throw new BadRequestException(`add-on ${addonCode} ไม่มีโควตาการใช้งาน`);
    return this.service.getStatus(tenantId, addonCode);
  }
}
