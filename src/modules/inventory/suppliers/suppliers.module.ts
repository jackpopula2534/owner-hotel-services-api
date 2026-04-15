import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { ItemSuppliersService } from './item-suppliers/item-suppliers.service';
import { ItemSuppliersController } from './item-suppliers/item-suppliers.controller';

@Module({
  imports: [AddonModule],
  controllers: [SuppliersController, ItemSuppliersController],
  providers: [SuppliersService, ItemSuppliersService],
  exports: [SuppliersService, ItemSuppliersService],
})
export class SuppliersModule {}
