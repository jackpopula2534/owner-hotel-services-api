import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { GuestFolioService } from './guest-folio.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../email/email.module';
import { AuditLogModule } from '../../audit-log/audit-log.module';
import { InvoicesModule } from '../../invoices/invoices.module';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';
import { LoyaltyModule } from '../../loyalty/loyalty.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [PrismaModule, EmailModule, AuditLogModule, InvoicesModule, HousekeepingModule, LoyaltyModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, GuestFolioService],
  exports: [BookingsService, GuestFolioService],
})
export class BookingsModule {}
