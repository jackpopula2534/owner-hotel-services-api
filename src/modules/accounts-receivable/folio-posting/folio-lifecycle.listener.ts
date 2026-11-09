import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CRM_EVENTS } from '@/modules/crm/crm.events';
import { FolioPostingService } from './folio-posting.service';

interface BookingLifecycleEvent {
  bookingId: string;
  tenantId: string;
  guestId: string;
}

/**
 * เชื่อมฝั่งหน้าเคาน์เตอร์ (bookings) กับ Guest Ledger ฝั่งบัญชี โดยไม่ต้องแก้ constructor
 * ของ BookingsService — เช็คอินแล้วเปิด folio ให้ทันที ล้มก็ไม่ล้มการเช็คอิน
 * (Night Audit จะกวาดเปิดให้อีกรอบก่อนลงค่าห้อง)
 */
@Injectable()
export class FolioLifecycleListener {
  private readonly logger = new Logger(FolioLifecycleListener.name);

  constructor(private readonly folioPosting: FolioPostingService) {}

  @OnEvent(CRM_EVENTS.BOOKING_CHECKED_IN, { async: true })
  async onCheckedIn(event: BookingLifecycleEvent): Promise<void> {
    try {
      await this.folioPosting.openFolioForBooking(event.tenantId, event.bookingId, 'system');
    } catch (error) {
      this.logger.error(
        `Open folio on check-in failed for booking ${event.bookingId}: ${(error as Error).message}`,
      );
    }
  }

  @OnEvent(CRM_EVENTS.BOOKING_CHECKED_OUT, { async: true })
  async onCheckedOut(event: BookingLifecycleEvent): Promise<void> {
    try {
      const res = await this.folioPosting.settleFolioOnCheckout(
        event.tenantId,
        event.bookingId,
        'system',
      );
      if (res?.status === 'PENDING') {
        this.logger.warn(
          `Booking ${event.bookingId} checked out with folio balance ${res.balance} — folio left PENDING`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Settle folio on check-out failed for booking ${event.bookingId}: ${(error as Error).message}`,
      );
    }
  }
}
