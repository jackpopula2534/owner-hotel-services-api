import { BadRequestException } from '@nestjs/common';
import { ArInvoicesService } from './ar-invoices.service';

// ─────────────────────────────────────────────────────────────────────────────
// ArInvoicesService - Thai tax-invoice compliance (LEGAL-03)
//   a) seller tax ID required before ISSUE
//   b) buyer tax ID required for CITY_LEDGER (B2B)
//   c) sequential invoice-number gap/duplicate detection
// ─────────────────────────────────────────────────────────────────────────────

describe('ArInvoicesService - issue() tax-ID enforcement', () => {
  const makeService = (overrides: { invoice: Record<string, unknown>; taxId?: string | null }) => {
    const prismaMock: any = {
      arInvoice: {
        findFirst: jest.fn().mockResolvedValue(overrides.invoice),
        update: jest.fn().mockResolvedValue({ ...overrides.invoice, status: 'ISSUED' }),
      },
      documentSettings: {
        // service อ่านด้วย findFirst({ tenantId, propertyId }) — mock เดิมเป็น findUnique
        // จึงล้มด้วย TypeError แล้ว "ผ่าน" เคส rejects แบบผิดเหตุผล
        findFirst: jest
          .fn()
          .mockResolvedValue(overrides.taxId === undefined ? null : { taxId: overrides.taxId }),
      },
      accountChart: {
        count: jest.fn().mockResolvedValue(69),
        findFirst: jest.fn(({ where }) =>
          Promise.resolve({ id: `acc-${where.code}`, code: where.code }),
        ),
      },
    };
    const journalEntries: any = { createAndPostAutoEntry: jest.fn().mockResolvedValue({}) };
    return {
      service: new ArInvoicesService(prismaMock, journalEntries),
      prisma: prismaMock,
      journalEntries,
    };
  };

  const baseInvoice = {
    id: 'inv-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    invoiceNo: 'INV-202605-000001',
    invoiceType: 'GUEST_BILL',
    status: 'DRAFT',
    companyTaxId: null,
    issueDate: new Date('2026-05-10'),
    totalAmount: 1070,
    vatAmount: 70,
    lines: [{ description: 'ค่าห้อง', netAmount: 1000, accountId: null }],
  };

  it('blocks issuing when the seller has no Tax ID in Document Settings', async () => {
    const { service, prisma } = makeService({ invoice: baseInvoice, taxId: null });

    await expect(service.issue('inv-1', 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.arInvoice.update).not.toHaveBeenCalled();
  });

  it('issues a guest-bill invoice once the seller Tax ID is set', async () => {
    const { service, prisma, journalEntries } = makeService({
      invoice: baseInvoice,
      taxId: '0105556000000',
    });

    const result = await service.issue('inv-1', 'tenant-1', 'user-1');

    expect(result.status).toBe('ISSUED');
    expect(prisma.arInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ISSUED' }) }),
    );
    // ตั้งลูกหนี้ต้องติดป้าย AR_INVOICE (เดิมใช้ AR_RECEIPT ปนกับใบเสร็จ)
    expect(journalEntries.createAndPostAutoEntry).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ sourceType: 'AR_INVOICE', sourceId: 'inv-1' }),
    );
  });

  it('keeps the invoice DRAFT when the journal cannot be posted (period closed)', async () => {
    const { service, prisma, journalEntries } = makeService({
      invoice: baseInvoice,
      taxId: '0105556000000',
    });
    journalEntries.createAndPostAutoEntry.mockRejectedValue(new BadRequestException('งวดปิดแล้ว'));

    await expect(service.issue('inv-1', 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.arInvoice.update).not.toHaveBeenCalled();
  });

  it('blocks a CITY_LEDGER invoice that has no buyer companyTaxId', async () => {
    const { service, prisma } = makeService({
      invoice: { ...baseInvoice, invoiceType: 'CITY_LEDGER', companyTaxId: null },
      taxId: '0105556000000',
    });

    await expect(service.issue('inv-1', 'tenant-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.arInvoice.update).not.toHaveBeenCalled();
  });

  it('issues a CITY_LEDGER invoice when the buyer companyTaxId is present', async () => {
    const { service } = makeService({
      invoice: { ...baseInvoice, invoiceType: 'CITY_LEDGER', companyTaxId: '0107537000000' },
      taxId: '0105556000000',
    });

    const result = await service.issue('inv-1', 'tenant-1', 'user-1');
    expect(result.status).toBe('ISSUED');
  });
});

describe('ArInvoicesService - detectSequenceGaps', () => {
  const makeService = (lastNumber: number, invoiceNos: string[]) => {
    const prismaMock: any = {
      documentSequence: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { tenantId: 'tenant-1', docType: 'INV', yearMonth: '202605', lastNumber },
          ]),
      },
      arInvoice: {
        findMany: jest.fn().mockResolvedValue(invoiceNos.map((invoiceNo) => ({ invoiceNo }))),
      },
    };
    return new ArInvoicesService(prismaMock);
  };

  it('reports ok when the sequence is complete and gapless', async () => {
    const service = makeService(3, ['INV-202605-000001', 'INV-202605-000002', 'INV-202605-000003']);

    const result = await service.detectSequenceGaps('tenant-1');

    expect(result.ok).toBe(true);
    expect(result.sequences[0].missing).toEqual([]);
    expect(result.sequences[0].duplicates).toEqual([]);
  });

  it('detects a missing number in the run', async () => {
    const service = makeService(3, ['INV-202605-000001', 'INV-202605-000003']);

    const result = await service.detectSequenceGaps('tenant-1');

    expect(result.ok).toBe(false);
    expect(result.sequences[0].missing).toEqual([2]);
  });

  it('detects a reused (duplicate) number', async () => {
    const service = makeService(2, ['INV-202605-000001', 'INV-202605-000002', 'INV-202605-000002']);

    const result = await service.detectSequenceGaps('tenant-1');

    expect(result.ok).toBe(false);
    expect(result.sequences[0].duplicates).toEqual([2]);
  });
});
