import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanFeaturesService } from './plan-features.service';
import { PlanFeaturesController } from './plan-features.controller';
import { PlanFeature } from './entities/plan-feature.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlanFeature]), PrismaModule],
  controllers: [PlanFeaturesController],
  providers: [PlanFeaturesService],
  exports: [
    TypeOrmModule, // exports Repository<PlanFeature>
    PlanFeaturesService,
  ],
})
export class PlanFeaturesModule {}
