import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WarehousesModule } from '../inventory/warehouses/warehouses.module';
import { StockMovementsModule } from '../inventory/stock-movements/stock-movements.module';
import { RevenueModule } from '../revenue/revenue.module';
import { CampgroundsController } from './campgrounds.controller';
import { CampgroundsService } from './campgrounds.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { PitchesController } from './pitches.controller';
import { PitchesService } from './pitches.service';
import { FacilitiesController } from './facilities.controller';
import { FacilitiesService } from './facilities.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { CampAccountingService } from './camp-accounting.service';
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';
import { CampDashboardController } from './dashboard.controller';
import { CampDashboardService } from './dashboard.service';
import { LoyaltyModule } from '../../loyalty/loyalty.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { AddonQuotaModule } from '../addon-quotas/addon-quota.module';
import { CampMap3dController } from './map3d/camp-map3d.controller';
import { CampMap3dService } from './map3d/camp-map3d.service';
import { CampOpsController } from './camp-ops.controller';
import { CampOpsService } from './camp-ops.service';

/**
 * CampModule — ระบบจัดการลานกางแคมป์ (CampSync sub-system)
 * แยกโดเมนจากระบบโรงแรม: Campground → Zone → Pitch → Reservation
 * เชื่อมกับ Inventory Module เพื่อ Auto-create คลังย่อย + ใบเบิก/ใบโอนของ
 *
 * ทุก controller ในโมดูลนี้ติด @RequireAddon('CAMP_MODULE') + AddonGuard
 * (AddonModule ให้ทั้ง guard และ AddonService ที่ guard ต้องใช้)
 * ฉาก 3D (map3d/) ใช้ add-on CAMP_3D_MAP เพิ่ม — AI ผ่าน AiGatewayModule + โควตาผ่าน AddonQuotaModule
 */
@Module({
  imports: [
    PrismaModule,
    AddonModule,
    IntegrationsModule,
    WarehousesModule,
    StockMovementsModule,
    RevenueModule,
    LoyaltyModule,
    AiGatewayModule,
    AddonQuotaModule,
  ],
  controllers: [
    CampgroundsController,
    ZonesController,
    PitchesController,
    FacilitiesController,
    ReservationsController,
    AddonsController,
    RequisitionsController,
    CampDashboardController,
    CampMap3dController,
    CampOpsController,
  ],
  providers: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    FacilitiesService,
    ReservationsService,
    CampAccountingService,
    AddonsService,
    RequisitionsService,
    CampDashboardService,
    CampMap3dService,
    CampOpsService,
  ],
  exports: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    FacilitiesService,
    ReservationsService,
    AddonsService,
    RequisitionsService,
  ],
})
export class CampModule {}
