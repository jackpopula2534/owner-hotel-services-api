import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
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

/**
 * CampModule — ระบบจัดการลานกางแคมป์ (CampSync sub-system)
 * แยกโดเมนจากระบบโรงแรม: Campground → Zone → Pitch → Reservation
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    CampgroundsController,
    ZonesController,
    PitchesController,
    ReservationsController,
    AddonsController,
  ],
  providers: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    ReservationsService,
    AddonsService,
  ],
  exports: [
    CampgroundsService,
    ZonesService,
    PitchesService,
    ReservationsService,
    AddonsService,
  ],
})
export class CampModule {}
