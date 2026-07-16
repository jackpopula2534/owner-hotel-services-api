import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { WarehousesModule } from '../inventory/warehouses/warehouses.module';
import { StockMovementsModule } from '../inventory/stock-movements/stock-movements.module';
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
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';
import { CampDashboardController } from './dashboard.controller';
import { CampDashboardService } from './dashboard.service';

/**
 * CampModule — ระบบจัดการลานกางแคมป์ (CampSync sub-system)
 * แยกโดเมนจากระบบโรงแรม: Campground → Zone → Pitch → Reservation
 * เชื่อมกับ Inventory Module เพื่อ Auto-create คลังย่อย + ใบเบิก/ใบโอนของ
 *
 * ทุก controller ในโมดูลนี้ติด @RequireAddon('CAMP_MODULE') + AddonGuard
 * (AddonModule ให้ทั้ง guard และ AddonService ที่ guard ต้องใช้)
 */
@Module({
  imports: [PrismaModule, AddonModule, WarehousesModule, StockMovementsModule],
  controllers: [
    CampgroundsController,
    ZonesController,
    PitchesController,
    FacilitiesController,
    ReservationsController,
    AddonsController,
    RequisitionsController,
    CampDashboardController,
  ],
  providers: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    FacilitiesService,
    ReservationsService,
    AddonsService,
    RequisitionsService,
    CampDashboardService,
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
