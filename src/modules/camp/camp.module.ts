import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WarehousesModule } from '../inventory/warehouses/warehouses.module';
import { StockMovementsModule } from '../inventory/stock-movements/stock-movements.module';
import { CampgroundsController } from './campgrounds.controller';
import { CampgroundsService } from './campgrounds.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { PitchesController } from './pitches.controller';
import { PitchesService } from './pitches.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { AddonsController } from './addons.controller';
import { AddonsService } from './addons.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';

/**
 * CampModule — ระบบจัดการลานกางแคมป์ (CampSync sub-system)
 * แยกโดเมนจากระบบโรงแรม: Campground → Zone → Pitch → Reservation
 * เชื่อมกับ Inventory Module เพื่อ Auto-create คลังย่อย + ใบเบิก/ใบโอนของ
 */
@Module({
  imports: [PrismaModule, WarehousesModule, StockMovementsModule],
  controllers: [
    CampgroundsController,
    ZonesController,
    PitchesController,
    ReservationsController,
    AddonsController,
    RequisitionsController,
  ],
  providers: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    ReservationsService,
    AddonsService,
    RequisitionsService,
  ],
  exports: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    ReservationsService,
    AddonsService,
    RequisitionsService,
  ],
})
export class CampModule {}
