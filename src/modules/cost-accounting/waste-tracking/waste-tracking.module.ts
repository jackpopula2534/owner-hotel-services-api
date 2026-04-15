import { Module } from '@nestjs/common';
import { WasteTrackingController } from './waste-tracking.controller';
import { WasteTrackingService } from './waste-tracking.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [WasteTrackingController],
  providers: [WasteTrackingService, PrismaService],
  exports: [WasteTrackingService],
})
export class WasteTrackingModule {}
