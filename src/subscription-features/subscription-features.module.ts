import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionFeaturesService } from './subscription-features.service';
import { SubscriptionFeaturesController } from './subscription-features.controller';
import { SubscriptionFeature } from './entities/subscription-feature.entity';
import { SubscriptionFeatureLogs } from './entities/subscription-feature-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionFeature, SubscriptionFeatureLogs]),
    PrismaModule,
  ],
  controllers: [SubscriptionFeaturesController],
  providers: [SubscriptionFeaturesService],
  exports: [
    TypeOrmModule, // exports Repository<SubscriptionFeature> + Repository<SubscriptionFeatureLogs>
    SubscriptionFeaturesService,
  ],
})
export class SubscriptionFeaturesModule {}
