/**
 * Test double for {@link FolioPostingService}, shared by the OrderService specs.
 *
 * `processPayment` only reaches the poster on a ROOM_CHARGE, so most specs just
 * need the provider to exist for Nest to build the module. The ones that do
 * exercise room charges override `postCharge`.
 *
 * The method name is checked against the real prototype: a mock that invents a
 * method keeps the suite green while the service calls something that no longer
 * exists, which is exactly how a mocked test passes over a broken endpoint.
 */
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';

export interface PostedFolioChargeStub {
  folioId: string;
  chargeId: string;
  bookingId: string;
  guestId: string;
  propertyId: string;
  alreadyPosted: boolean;
}

export const DEFAULT_POSTED_CHARGE: PostedFolioChargeStub = {
  folioId: 'folio-1',
  chargeId: 'charge-1',
  bookingId: 'booking-1',
  guestId: 'guest-1',
  propertyId: 'prop-1',
  alreadyPosted: false,
};

export function buildFolioPostingStub(posted: PostedFolioChargeStub = DEFAULT_POSTED_CHARGE) {
  const real = FolioPostingService.prototype as unknown as Record<string, unknown>;
  if (typeof real.postCharge !== 'function' || typeof real.reverseCharge !== 'function') {
    throw new Error(
      'FolioPostingService no longer exposes postCharge/reverseCharge — update this stub ' +
        'instead of letting the OrderService specs pass against a method that is gone.',
    );
  }

  return {
    postCharge: jest.fn().mockResolvedValue(posted),
    reverseCharge: jest.fn().mockResolvedValue(true),
  };
}
