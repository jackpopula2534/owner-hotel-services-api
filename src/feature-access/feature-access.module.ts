import { Module } from '@nestjs/common';
import { FeatureAccessService } from './feature-access.service';
import { FeatureAccessController } from './feature-access.controller';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [TenantsModule, SubscriptionsModule, FeaturesModule],
  controllers: [FeatureAccessController],
  providers: [FeatureAccessService],
  exports: [FeatureAccessService],
})
export class FeatureAccessModule {}


