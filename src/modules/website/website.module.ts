import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PropertiesModule } from '../properties/properties.module';
import { AddonModule } from '../addons/addon.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PromptPayModule } from '../../promptpay/promptpay.module';
import { CampModule } from '../camp/camp.module';
import { WebsiteAdminController } from './website-admin.controller';
import { WebsitePublicController } from './website-public.controller';
import { WebsiteService } from './website.service';
import { WebsitePublicService } from './website-public.service';
import { WebsiteEntitlementService } from './website-entitlement.service';
import { WebsiteBookingService } from './website-booking.service';
import { WebsitePaymentService } from './website-payment.service';
import { WebsiteCampPublicService } from './website-camp-public.service';
import { WebsiteCampBookingService } from './website-camp-booking.service';

@Module({
  imports: [
    PrismaModule,
    AddonModule,
    NotificationsModule,
    BookingsModule,
    PromptPayModule,
    PropertiesModule,
    CampModule,
  ],
  controllers: [WebsiteAdminController, WebsitePublicController],
  providers: [
    WebsiteService,
    WebsitePublicService,
    WebsiteEntitlementService,
    WebsiteBookingService,
    WebsitePaymentService,
    WebsiteCampPublicService,
    WebsiteCampBookingService,
  ],
  exports: [WebsiteEntitlementService],
})
export class WebsiteModule {}
