import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanFeaturesService } from './plan-features.service';
import { PlanFeaturesController } from './plan-features.controller';
import { PlanFeature } from './entities/plan-feature.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlanFeature])],
  controllers: [PlanFeaturesController],
  providers: [PlanFeaturesService],
  exports: [PlanFeaturesService],
})
export class PlanFeaturesModule {}


