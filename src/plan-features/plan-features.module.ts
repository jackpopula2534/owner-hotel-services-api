import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanFeaturesService } from './plan-features.service';
import { PlanFeaturesController } from './plan-features.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PlanFeaturesController],
  providers: [PlanFeaturesService],
  exports: [PlanFeaturesService],
})
export class PlanFeaturesModule {}


