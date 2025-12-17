import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionFeaturesService } from './subscription-features.service';
import { SubscriptionFeaturesController } from './subscription-features.controller';
import { SubscriptionFeature } from './entities/subscription-feature.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SubscriptionFeature])],
  controllers: [SubscriptionFeaturesController],
  providers: [SubscriptionFeaturesService],
  exports: [SubscriptionFeaturesService],
})
export class SubscriptionFeaturesModule {}


