import { Module } from '@nestjs/common';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [PrismaModule, AddonModule, OrderModule],
  controllers: [ReservationController],
  providers: [ReservationService],
  exports: [ReservationService],
})
export class ReservationModule {}
