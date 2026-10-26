import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { HotelMap3dController } from './hotel-map3d.controller';
import { HotelMap3dService } from './hotel-map3d.service';

/** ฉาก 3D ของโรงแรม (Monitor ห้องพัก 3D + ปรับแต่งอาคาร 3D) */
@Module({
  imports: [PrismaModule],
  controllers: [HotelMap3dController],
  providers: [HotelMap3dService],
})
export class HotelMap3dModule {}
