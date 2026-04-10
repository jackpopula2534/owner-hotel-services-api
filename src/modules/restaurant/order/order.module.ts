import { Module, forwardRef } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderPublicController } from './order-public.controller';
import { OrderService } from './order.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { KitchenModule } from '../kitchen/kitchen.module';

@Module({
  imports: [PrismaModule, forwardRef(() => KitchenModule)],
  controllers: [OrderController, OrderPublicController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
