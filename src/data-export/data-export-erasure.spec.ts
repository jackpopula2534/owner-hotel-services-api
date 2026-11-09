import { DataExportProcessor } from './data-export.processor';
import { DATA_EXPORT_JOBS } from './data-export.constants';

// ─────────────────────────────────────────────────────────────────────────────
// DataExportProcessor - erasure completeness (LEGAL-01 / PDPA มาตรา 33)
//
// Guest PII is denormalized onto Booking (guestFirstName/LastName/Email/Phone)
// and TableReservation (guestName/Phone/Email). Erasure must redact those rows
// too — otherwise PII survives a "Right to Erasure" request.
// ─────────────────────────────────────────────────────────────────────────────

describe('DataExportProcessor - erasure anonymizes denormalized PII', () => {
  const buildProcessor = () => {
    const prismaMock: any = {
      data_export_requests: { update: jest.fn().mockResolvedValue({}) },
      guest: { findMany: jest.fn().mockResolvedValue([]) },
      employee: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      tableReservation: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const exportServiceMock: any = {
      complete: jest.fn().mockResolvedValue({}),
      fail: jest.fn().mockResolvedValue({}),
    };
    const processor = new DataExportProcessor(prismaMock, exportServiceMock);
    return { processor, prisma: prismaMock, exportService: exportServiceMock };
  };

  const job: any = {
    name: DATA_EXPORT_JOBS.PROCESS_ERASURE,
    data: { requestId: 'req-1', tenantId: 'tenant-1' },
  };

  it('redacts guest PII denormalized on Booking rows', async () => {
    const { processor, prisma } = buildProcessor();

    await processor.handleErasure(job);

    expect(prisma.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        data: expect.objectContaining({
          guestFirstName: '[REDACTED]',
          guestLastName: '[REDACTED]',
          guestEmail: 'redacted@anonymized.invalid',
          guestPhone: '0000000000',
        }),
      }),
    );
  });

  it('redacts guest PII denormalized on TableReservation rows', async () => {
    const { processor, prisma } = buildProcessor();

    await processor.handleErasure(job);

    expect(prisma.tableReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
        data: expect.objectContaining({
          guestName: '[REDACTED]',
          guestEmail: 'redacted@anonymized.invalid',
          guestPhone: '0000000000',
        }),
      }),
    );
  });

  it('reports anonymized counts for bookings and reservations in the summary', async () => {
    const { processor, exportService } = buildProcessor();

    await processor.handleErasure(job);

    // complete(requestId, dataUri, byteSize, expiresAt) — decode the JSON summary
    const dataUri: string = exportService.complete.mock.calls[0][1];
    const base64 = dataUri.split(',')[1];
    const summary = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));

    expect(summary.bookingsAnonymized).toBe(3);
    expect(summary.reservationsAnonymized).toBe(2);
  });
});
