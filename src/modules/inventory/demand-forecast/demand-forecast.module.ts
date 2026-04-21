import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { DemandForecastService } from './demand-forecast.service';
import { DemandForecastController } from './demand-forecast.controller';

@Module({
  imports: [AddonModule],
  controllers: [DemandForecastController],
  providers: [DemandForecastService],
  exports: [DemandForecastService],
})
export class DemandForecastModule {}
