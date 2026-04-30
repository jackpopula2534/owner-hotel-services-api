import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubscriptionGuard } from './subscription/subscription.guard';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { GuestsModule } from './modules/guests/guests.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { RestaurantModule } from './modules/restaurant/restaurant.module';
import { HrModule } from './modules/hr/hr.module';
import { UsersModule } from './modules/users/users.module';
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
import { AdminModule } from './admin/admin.module';
import { SeederModule } from './seeder/seeder.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ContactModule } from './contact/contact.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { PromotionsModule } from './promotions/promotions.module';
import { EmailModule } from './email/email.module';
import { PromptPayModule } from './promptpay/promptpay.module';
import { TwoFactorAuthModule } from './two-factor-auth/two-factor-auth.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { CacheModule } from './cache/cache.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LineNotifyModule } from './line-notify/line-notify.module';
import { I18nModule } from './i18n/i18n.module';
import { DatabaseOptimizationModule } from './database-optimization/database-optimization.module';
import { MobileApiModule } from './mobile-api/mobile-api.module';
import { PushNotificationsModule } from './push-notifications/push-notifications.module';
import { HealthModule } from './health/health.module';
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SearchModule } from './modules/search/search.module';
import { StaffModule } from './modules/staff/staff.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AddonModule } from './modules/addons/addon.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProcurementUsersModule } from './modules/procurement-users/procurement-users.module';
import { WarehouseUsersModule } from './modules/warehouse-users/warehouse-users.module';
import { HotelTerminalUsersModule } from './modules/hotel-terminal-users/hotel-terminal-users.module';
import { CostAccountingModule } from './modules/cost-accounting/cost-accounting.module';
import { DocumentSettingsModule } from './modules/document-settings/document-settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate, // throws at startup if any required env var is missing
    }),
    EventEmitterModule.forRoot({
      // Use this so event handlers don't block the emitter
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
    PrismaModule,
    AuthModule,
    GuestsModule,
    BookingsModule,
    RoomsModule,
    PropertiesModule,
    RestaurantModule,
    HrModule,
    UsersModule,
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
    AdminModule,
    SeederModule,
    NotificationsModule,
    ContactModule,
    AnalyticsModule,
    LoyaltyModule,
    PromotionsModule,
    EmailModule,
    PromptPayModule,
    TwoFactorAuthModule,
    AuditLogModule,
    CacheModule,
    ReportsModule,
    LineNotifyModule,
    I18nModule,
    DatabaseOptimizationModule,
    MobileApiModule,
    PushNotificationsModule,
    HealthModule,
    HousekeepingModule,
    DashboardModule,
    SearchModule,
    StaffModule,
    MaintenanceModule,
    AddonModule,
    InventoryModule,
    ProcurementUsersModule,
    WarehouseUsersModule,
    HotelTerminalUsersModule,
    CostAccountingModule,
    DocumentSettingsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60, // 60 seconds window
        limit: 100, // 100 requests per IP per window (global default)
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard,
    },
  ],
})
export class AppModule {}
