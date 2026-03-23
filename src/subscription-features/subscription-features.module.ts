import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionFeaturesService } from './subscription-features.service';
import { SubscriptionFeaturesController } from './subscription-features.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionFeaturesController],
  providers: [SubscriptionFeaturesService],
  exports: [SubscriptionFeaturesService],
})
export class SubscriptionFeaturesModule {}


