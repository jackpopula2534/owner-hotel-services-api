import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { RoomAvailabilityService } from './room-availability.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomAvailabilityService],
  exports: [RoomsService, RoomAvailabilityService],
})
export class RoomsModule {}
