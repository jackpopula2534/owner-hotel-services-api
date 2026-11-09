import type { PrismaService } from '@/prisma/prisma.service';
import { markWebsiteQrVerified } from './website-qr-verification';

describe('markWebsiteQrVerified', () => {
  const build = (pendingInGroup: number) => {
    const prisma = {
      booking: { findMany: jest.fn().mockResolvedValue([{ id: 'b-1' }, { id: 'b-2' }]) },
      payments: { count: jest.fn().mockResolvedValue(pendingInGroup) },
      promptPayTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const mark = (booking: { id: string; bookingGroupId: string | null }) =>
      markWebsiteQrVerified(prisma as unknown as PrismaService, booking, 'tenant-1');
    return { prisma, mark };
  };

  it('verifies the QR of a single-room booking right away', async () => {
    const { prisma, mark } = build(0);
    await mark({ id: 'b-1', bookingGroupId: null });
    expect(prisma.payments.count).not.toHaveBeenCalled();
    expect(prisma.promptPayTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ bookingId: { in: ['b-1'] } }) }),
    );
  });

  it('waits until every room of a multi-room booking is confirmed', async () => {
    const pending = build(1);
    await pending.mark({ id: 'b-2', bookingGroupId: 'grp-1' });
    expect(pending.prisma.promptPayTransaction.updateMany).not.toHaveBeenCalled();

    const done = build(0);
    await done.mark({ id: 'b-2', bookingGroupId: 'grp-1' });
    expect(done.prisma.booking.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', bookingGroupId: 'grp-1' },
      select: { id: true },
    });
    expect(done.prisma.promptPayTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: { in: ['b-1', 'b-2'] }, tenantId: 'tenant-1' }),
      }),
    );
  });
});
