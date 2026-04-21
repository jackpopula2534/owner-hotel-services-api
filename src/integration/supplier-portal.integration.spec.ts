import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import {
  SupplierPortalService,
  hashSupplierPortalToken,
} from '../modules/inventory/supplier-portal/supplier-portal.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Integration-style spec for the supplier-portal flow.
 *
 * We don't touch a real database — the existing integration specs in this
 * directory already use a Prisma mock. This spec threads the two critical
 * paths end-to-end through SupplierPortalService alone:
 *
 *   Flow A — generateTokensForRfq → verifyToken → markTokenUsed → 2nd verify fails
 *   Flow B — regenerateTokenForSupplier revokes old tokens so the old link dies
 *   Flow C — getPortalSession returns the expected payload for a valid token
 */
describe('Supplier Portal — integration flow', () => {
  let service: SupplierPortalService;

  // In-memory "database" of tokens keyed by tokenHash (matches findUnique)
  interface StoredToken {
    id: string;
    tenantId: string;
    supplierQuoteId: string;
    requestForQuotationId: string;
    supplierId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    lastAccessedAt: Date | null;
    accessCount: number;
  }

  const store: StoredToken[] = [];
  let nextId = 1;

  const prismaMock = {
    requestForQuotation: { findFirst: jest.fn() },
    supplierQuote: { findFirst: jest.fn() },
    supplierQuoteToken: {
      findUnique: jest.fn(
        async ({ where }: { where: { tokenHash: string } }) =>
          store.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Partial<StoredToken> }) => {
        const row: StoredToken = {
          id: `tok-${nextId++}`,
          tenantId: data.tenantId!,
          supplierQuoteId: data.supplierQuoteId!,
          requestForQuotationId: data.requestForQuotationId!,
          supplierId: data.supplierId!,
          tokenHash: data.tokenHash!,
          expiresAt: data.expiresAt!,
          usedAt: null,
          revokedAt: null,
          lastAccessedAt: null,
          accessCount: 0,
        };
        store.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            lastAccessedAt?: Date;
            accessCount?: { increment: number };
          };
        }) => {
          const row = store.find((t) => t.id === where.id);
          if (!row) throw new Error('not found');
          if (data.lastAccessedAt !== undefined) row.lastAccessedAt = data.lastAccessedAt;
          const ac = data.accessCount;
          if (ac && typeof ac === 'object' && 'increment' in ac) {
            row.accessCount += ac.increment;
          }
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Partial<StoredToken>; data: Partial<StoredToken> }) => {
          let count = 0;
          for (const row of store) {
            if (where.id !== undefined && row.id !== where.id) continue;
            if (where.tenantId !== undefined && row.tenantId !== where.tenantId) continue;
            if (
              where.supplierQuoteId !== undefined &&
              row.supplierQuoteId !== where.supplierQuoteId
            )
              continue;
            if (where.usedAt === null && row.usedAt !== null) continue;
            if (where.revokedAt === null && row.revokedAt !== null) continue;
            if (data.usedAt !== undefined) row.usedAt = data.usedAt;
            if (data.revokedAt !== undefined) row.revokedAt = data.revokedAt;
            count += 1;
          }
          return { count };
        },
      ),
    },
  };

  const configMock = {
    get: jest.fn((key: string) =>
      key === 'FRONTEND_URL' ? 'https://portal.staysync.test' : undefined,
    ),
  };

  beforeEach(async () => {
    store.length = 0;
    nextId = 1;
    jest.clearAllMocks();

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = mod.get<SupplierPortalService>(SupplierPortalService);
  });

  const tenantId = 'tenant-1';
  const rfqId = 'rfq-1';
  const supplierId = 'sup-1';
  const supplierQuoteId = 'sq-1';
  const futureDeadline = new Date(Date.now() + 7 * 86_400_000);

  function stubRfqWithOneRecipient(): void {
    prismaMock.requestForQuotation.findFirst.mockResolvedValue({
      id: rfqId,
      tenantId,
      round: 1,
      deadline: futureDeadline,
      recipients: [
        {
          supplierId,
          supplier: {
            id: supplierId,
            name: 'Alpha Co.',
            email: 'alpha@x.test',
            contactPerson: null,
            phone: null,
          },
        },
      ],
      supplierQuotes: [{ id: supplierQuoteId, supplierId, round: 1, status: 'REQUESTED' }],
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Flow A — single-use guarantee
  // ═══════════════════════════════════════════════════════════
  it('Flow A: generate → verify → markUsed → re-verify fails (single-use)', async () => {
    stubRfqWithOneRecipient();

    const [generated] = await service.generateTokensForRfq(tenantId, rfqId);
    expect(generated.rawToken).toBeTruthy();
    expect(store).toHaveLength(1);
    expect(store[0].tokenHash).toBe(hashSupplierPortalToken(generated.rawToken));

    // 1st verify OK
    const ctx = await service.verifyToken(generated.rawToken);
    expect(ctx.supplierQuoteId).toBe(supplierQuoteId);
    expect(store[0].accessCount).toBe(1);

    // Burn
    await service.markTokenUsed(ctx.tokenId);
    expect(store[0].usedAt).toBeInstanceOf(Date);

    // 2nd verify — already used
    await expect(service.verifyToken(generated.rawToken)).rejects.toThrow(/ถูกใช้ไปแล้ว/);

    // markUsed again — no-op, but throws because row already used
    await expect(service.markTokenUsed(ctx.tokenId)).rejects.toThrow(ForbiddenException);
  });

  // ═══════════════════════════════════════════════════════════
  // Flow B — regeneration revokes old tokens
  // ═══════════════════════════════════════════════════════════
  it('Flow B: regenerate revokes old, new raw token works, old raw token fails', async () => {
    stubRfqWithOneRecipient();

    const [original] = await service.generateTokensForRfq(tenantId, rfqId);
    expect(store).toHaveLength(1);

    // Regenerate for the same supplier
    const regen = await service.regenerateTokenForSupplier(tenantId, rfqId, supplierId);

    // Two rows: the old one is revoked, the new one is active
    expect(store).toHaveLength(2);
    const oldRow = store.find((r) => r.tokenHash === hashSupplierPortalToken(original.rawToken));
    const newRow = store.find((r) => r.tokenHash === hashSupplierPortalToken(regen.rawToken));
    expect(oldRow?.revokedAt).toBeInstanceOf(Date);
    expect(newRow?.revokedAt).toBeNull();

    // Old token no longer works
    await expect(service.verifyToken(original.rawToken)).rejects.toThrow(/ยกเลิกแล้ว/);
    // New token works
    const ctx = await service.verifyToken(regen.rawToken);
    expect(ctx.tokenId).toBe(newRow!.id);
  });

  // ═══════════════════════════════════════════════════════════
  // Flow C — getPortalSession happy path
  // ═══════════════════════════════════════════════════════════
  it('Flow C: getPortalSession returns shaped payload for a valid token', async () => {
    stubRfqWithOneRecipient();
    const [generated] = await service.generateTokensForRfq(tenantId, rfqId);

    prismaMock.supplierQuote.findFirst.mockResolvedValue({
      id: supplierQuoteId,
      status: 'REQUESTED',
      quoteNumber: null,
      currency: 'THB',
      paymentTerms: null,
      deliveryDays: null,
      validUntil: null,
      notes: null,
      totalAmount: '0',
      supplier: {
        id: supplierId,
        name: 'Alpha Co.',
        email: 'alpha@x.test',
        contactPerson: null,
        phone: null,
      },
      purchaseRequisition: {
        id: 'pr-1',
        prNumber: 'PR-0001',
        department: 'F&B',
        requiredDate: new Date(Date.now() + 5 * 86_400_000),
        items: [
          {
            id: 'pri-1',
            itemId: 'item-1',
            quantity: 10,
            item: { id: 'item-1', name: 'Tomato', sku: 'SKU-1', unit: 'KG' },
          },
        ],
      },
      items: [],
    });
    // Second call (for the RFQ header)
    prismaMock.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: rfqId,
      tenantId,
      round: 1,
      deadline: futureDeadline,
      recipients: [
        {
          supplierId,
          supplier: {
            id: supplierId,
            name: 'Alpha Co.',
            email: 'alpha@x.test',
            contactPerson: null,
            phone: null,
          },
        },
      ],
      supplierQuotes: [{ id: supplierQuoteId, supplierId, round: 1, status: 'REQUESTED' }],
    });
    prismaMock.requestForQuotation.findFirst.mockResolvedValueOnce({
      id: rfqId,
      rfqNumber: 'RFQ-001',
      subject: 'Groceries',
      coverLetter: null,
      customTerms: null,
      deadline: futureDeadline,
      issuedAt: new Date(),
      status: 'SENT',
    });

    const session = (await service.getPortalSession(generated.rawToken)) as {
      rfq: { rfqNumber: string };
      supplier: { name: string };
      purchaseRequisition: { items: unknown[] };
      quote: { id: string };
    };

    expect(session.rfq.rfqNumber).toBe('RFQ-001');
    expect(session.supplier.name).toBe('Alpha Co.');
    expect(session.quote.id).toBe(supplierQuoteId);
    expect(session.purchaseRequisition.items).toHaveLength(1);
  });

  // ═══════════════════════════════════════════════════════════
  // Flow D — revokeTokensForQuote kills everything for that quote
  // ═══════════════════════════════════════════════════════════
  it('Flow D: revokeTokensForQuote revokes all active tokens in one sweep', async () => {
    stubRfqWithOneRecipient();
    await service.generateTokensForRfq(tenantId, rfqId);
    await service.regenerateTokenForSupplier(tenantId, rfqId, supplierId);

    // 2 rows total, 1 already revoked (the original) and 1 active
    expect(store).toHaveLength(2);
    const active = store.filter((r) => r.revokedAt === null).length;
    expect(active).toBe(1);

    const n = await service.revokeTokensForQuote(tenantId, supplierQuoteId);
    expect(n).toBe(1);
    for (const row of store) {
      expect(row.revokedAt).toBeInstanceOf(Date);
    }
  });
});
