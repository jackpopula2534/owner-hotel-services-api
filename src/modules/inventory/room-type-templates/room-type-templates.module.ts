import { Module } from '@nestjs/common';
import { RoomTypeTemplatesService } from './room-type-templates.service';
import { RoomTypeTemplatesController } from './room-type-templates.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';

@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [RoomTypeTemplatesController],
  providers: [RoomTypeTemplatesService],
  exports: [RoomTypeTemplatesService],
})
export class RoomTypeTemplatesModule {}
