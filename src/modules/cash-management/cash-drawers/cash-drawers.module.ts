import { Module } from '@nestjs/common';
import { CashDrawersController } from './cash-drawers.controller';
import { CashDrawersService } from './cash-drawers.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [CashDrawersController],
  providers: [CashDrawersService],
  exports: [CashDrawersService],
})
export class CashDrawersModule {}
