import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';

@Module({
  imports: [AddonModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
