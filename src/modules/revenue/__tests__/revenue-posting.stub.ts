/**
 * Test double for {@link RevenuePostingService}, shared by the four channels
 * that record revenue (restaurant, retail, bookings, camp).
 *
 * Those specs mock Prisma, so the real poster can never run against them — it
 * needs a live transaction client and a real unique index to do its job. What
 * the specs *can* pin is that each channel hands the poster the right document,
 * which is what this stub captures.
 *
 * The method names are checked against the real prototype: a stub that invents
 * a method keeps the suite green while the service calls something that no
 * longer exists — the exact failure mode where a mocked test sails over a
 * broken endpoint. Real behaviour is proven separately by
 * `scripts/verify-revenue-ledger.ts` against hotel_services_db.
 */
import { RevenuePostingService } from '../revenue-posting.service';

const REQUIRED_METHODS = ['post', 'postWithin', 'void', 'voidWithin'] as const;

export function buildRevenuePostingStub() {
  const real = RevenuePostingService.prototype as unknown as Record<string, unknown>;
  for (const method of REQUIRED_METHODS) {
    if (typeof real[method] !== 'function') {
      throw new Error(
        `RevenuePostingService no longer exposes ${method}() — update this stub instead of ` +
          'letting the revenue-channel specs pass against a method that is gone.',
      );
    }
  }

  const posted = {
    entryIds: ['rev-1'],
    businessDate: '2026-08-17',
    netAmount: 0,
    created: 1,
    updated: 0,
    unchanged: 0,
  };
  const voided = { voided: 0, reversed: 0, unchanged: 0 };

  return {
    post: jest.fn().mockResolvedValue(posted),
    postWithin: jest.fn().mockResolvedValue(posted),
    void: jest.fn().mockResolvedValue(voided),
    voidWithin: jest.fn().mockResolvedValue(voided),
  };
}

export type RevenuePostingStub = ReturnType<typeof buildRevenuePostingStub>;

/** The `PostRevenueInput` a channel handed the poster on its `postWithin` call. */
export const postedRevenueInput = (stub: RevenuePostingStub, call = 0) =>
  stub.postWithin.mock.calls[call]?.[1];
