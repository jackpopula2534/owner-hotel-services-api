import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { GuestsModule } from './modules/guests/guests.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RestaurantModule } from './modules/restaurant/restaurant.module';
import { HrModule } from './modules/hr/hr.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { TenantsModule } from './tenants/tenants.module';
import { PlansModule } from './plans/plans.module';
import { FeaturesModule } from './features/features.module';
import { PlanFeaturesModule } from './plan-features/plan-features.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SubscriptionFeaturesModule } from './subscription-features/subscription-features.module';
import { InvoicesModule } from './invoices/invoices.module';
import { InvoiceItemsModule } from './invoice-items/invoice-items.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminsModule } from './admins/admins.module';
import { FeatureAccessModule } from './feature-access/feature-access.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { AdminApprovalModule } from './admin-approval/admin-approval.module';
import { SubscriptionManagementModule } from './subscription-management/subscription-management.module';
import { AdminPanelModule } from './admin-panel/admin-panel.module';
import { SeederModule } from './seeder/seeder.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    GuestsModule,
    BookingsModule,
    RoomsModule,
    RestaurantModule,
    HrModule,
    ChannelsModule,
    ReviewsModule,
    DatabaseModule,
    TenantsModule,
    PlansModule,
    FeaturesModule,
    PlanFeaturesModule,
    SubscriptionsModule,
    SubscriptionFeaturesModule,
    InvoicesModule,
    InvoiceItemsModule,
    PaymentsModule,
    AdminsModule,
    FeatureAccessModule,
    OnboardingModule,
    SubscriptionModule,
    AdminApprovalModule,
    SubscriptionManagementModule,
    AdminPanelModule,
    SeederModule,
  ],
})
export class AppModule {}

