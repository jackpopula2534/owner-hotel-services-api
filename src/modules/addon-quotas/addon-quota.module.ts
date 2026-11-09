import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { AddonQuotaAdminController } from './addon-quota-admin.controller';
import { AddonQuotaAdminService } from './addon-quota-admin.service';
import { AddonQuotaController } from './addon-quota.controller';
import { AddonQuotaService } from './addon-quota.service';

/**
 * โควตาการใช้งานของ add-on ที่คิดตามจำนวนครั้ง (CAMP_3D_MAP → CAMP_3D_AI_EXTRACT)
 * ฟีเจอร์ที่เรียก AI import โมดูลนี้แล้วห่องานด้วย AddonQuotaService.runWithQuota()
 */
@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [AddonQuotaAdminController, AddonQuotaController],
  providers: [AddonQuotaService, AddonQuotaAdminService],
  exports: [AddonQuotaService],
})
export class AddonQuotaModule {}
