import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupplierPortalService, hashSupplierPortalToken } from '../supplier-portal.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Unit tests for SupplierPortalService.
 *
 * The service talks to Prisma + crypto — we mock Prisma and let the real
 * crypto primitives run so we validate the hash contract end-to-end.
 */
describe('SupplierPortalService', () => {
  let service: SupplierPortalService;

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://portal.staysync.test';
      if (key === 'APP_BASE_URL') return undefined;
      return undefined;
    }),
  };

  const mockPrisma = {
    requestForQuotation: {
      findFirst: jest.fn(),
    },
    supplierQuote: {
      findFirst: jest.fn(),
    },
    supplierQuoteToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const tenantId = 'tenant-ABC';
  const rfqId = 'rfq-1';
  const supplierId = 'sup-1';
  const supplierQuoteId = 'sq-1';

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = mod.get<SupplierPortalService>(SupplierPortalService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── helpers ───────────────────────────────────────────────
  const futureDate = (daysAhead: number): Date => new Date(Date.now() + daysAhead * 86_400_000);

  const pastDate = (daysAgo: number): Date => new Date(Date.now() - daysAgo * 86_400_000);

  // ═══════════════════════════════════════════════════════════
  // hashSupplierPortalToken helper
  // ═══════════════════════════════════════════════════════════
  describe('hashSupplierPortalToken', () => {
    it('produces a stable sha256 hex digest', () => {
      const a = hashSupplierPortalToken('foo');
      const b = hashSupplierPortalToken('foo');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different inputs', () => {
      const a = hashSupplierPortalToken('foo');
      const b = hashSupplierPortalToken('bar');
      expect(a).not.toBe(b);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // generateTokensForRfq
  // ═══════════════════════════════════════════════════════════
  describe('generateTokensForRfq', () => {
    it('throws NotFoundException if RFQ not found in tenant', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue(null);

      await expect(service.generateTokensForRfq(tenantId, rfqId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates one token per recipient with a matching skeleton quote', async () => {
      const deadline = futureDate(7);
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 1,
        deadline,
        recipients: [
          {
            supplierId: 'sup-A',
            supplier: { id: 'sup-A', name: 'Alpha', email: 'a@x.test' },
          },
          {
            supplierId: 'sup-B',
            supplier: { id: 'sup-B', name: 'Beta', email: null },
          },
        ],
        supplierQuotes: [
          { id: 'q-A', supplierId: 'sup-A', status: 'REQUESTED', round: 1 },
          { id: 'q-B', supplierId: 'sup-B', status: 'REQUESTED', round: 1 },
        ],
      });
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.supplierQuoteToken.create.mockResolvedValue({});

      const result = await service.generateTokensForRfq(tenantId, rfqId);

      expect(result).toHaveLength(2);
      expect(result[0].supplierQuoteId).toBe('q-A');
      expect(result[0].supplierEmail).toBe('a@x.test');
      expect(result[0].rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result[0].portalUrl).toContain(
        'https://portal.staysync.test/supplier-portal/quote?token=',
      );
      expect(result[0].expiresAt).toEqual(deadline);
      expect(result[1].supplierEmail).toBeNull();

      // Revoked previous tokens exactly once per recipient
      expect(mockPrisma.supplierQuoteToken.updateMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.supplierQuoteToken.create).toHaveBeenCalledTimes(2);

      // Stored hash, never raw
      const createArgs = mockPrisma.supplierQuoteToken.create.mock.calls[0][0];
      expect(createArgs.data.tokenHash).toHaveLength(64);
      expect(createArgs.data.tokenHash).not.toBe(result[0].rawToken);
    });

    it('skips recipients with no matching skeleton quote for the round', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 2,
        deadline: futureDate(5),
        recipients: [
          {
            supplierId: 'sup-A',
            supplier: { id: 'sup-A', name: 'Alpha', email: 'a@x.test' },
          },
          {
            supplierId: 'sup-B',
            supplier: { id: 'sup-B', name: 'Beta', email: 'b@x.test' },
          },
        ],
        supplierQuotes: [
          // Only supplier A has a round-2 quote
          { id: 'q-A2', supplierId: 'sup-A', status: 'REQUESTED', round: 2 },
          { id: 'q-B1', supplierId: 'sup-B', status: 'RECEIVED', round: 1 },
        ],
      });
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.supplierQuoteToken.create.mockResolvedValue({});

      const result = await service.generateTokensForRfq(tenantId, rfqId);

      expect(result).toHaveLength(1);
      expect(result[0].supplierQuoteId).toBe('q-A2');
    });

    it('falls back to +14 days when RFQ deadline is missing or past', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 1,
        deadline: pastDate(2), // stale deadline
        recipients: [
          {
            supplierId: 'sup-A',
            supplier: { id: 'sup-A', name: 'Alpha', email: 'a@x.test' },
          },
        ],
        supplierQuotes: [{ id: 'q-A', supplierId: 'sup-A', status: 'REQUESTED', round: 1 }],
      });
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.supplierQuoteToken.create.mockResolvedValue({});

      const before = Date.now();
      const [res] = await service.generateTokensForRfq(tenantId, rfqId);
      const after = Date.now();

      const minExpected = before + 13 * 86_400_000;
      const maxExpected = after + 15 * 86_400_000;
      expect(res.expiresAt.getTime()).toBeGreaterThan(minExpected);
      expect(res.expiresAt.getTime()).toBeLessThan(maxExpected);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // regenerateTokenForSupplier
  // ═══════════════════════════════════════════════════════════
  describe('regenerateTokenForSupplier', () => {
    it('throws NotFoundException if RFQ missing', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue(null);
      await expect(service.regenerateTokenForSupplier(tenantId, rfqId, supplierId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException if supplier not a recipient', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 1,
        deadline: futureDate(3),
        recipients: [],
        supplierQuotes: [],
      });
      await expect(service.regenerateTokenForSupplier(tenantId, rfqId, supplierId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException if no skeleton quote for current round', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 2,
        deadline: futureDate(3),
        recipients: [
          {
            supplierId,
            supplier: { id: supplierId, name: 'Alpha', email: 'a@x.test' },
          },
        ],
        supplierQuotes: [{ id: 'q-1', supplierId, round: 1, status: 'RECEIVED' }],
      });
      await expect(service.regenerateTokenForSupplier(tenantId, rfqId, supplierId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('revokes old tokens and returns a new raw token + portal URL', async () => {
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        tenantId,
        round: 1,
        deadline: futureDate(3),
        recipients: [
          {
            supplierId,
            supplier: { id: supplierId, name: 'Alpha', email: 'a@x.test' },
          },
        ],
        supplierQuotes: [{ id: supplierQuoteId, supplierId, round: 1, status: 'REQUESTED' }],
      });
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.supplierQuoteToken.create.mockResolvedValue({});

      const res = await service.regenerateTokenForSupplier(tenantId, rfqId, supplierId);

      expect(res.supplierQuoteId).toBe(supplierQuoteId);
      expect(res.supplierEmail).toBe('a@x.test');
      expect(res.rawToken.length).toBeGreaterThanOrEqual(32);
      expect(res.portalUrl).toContain('token=');

      // old tokens revoked before new one created
      expect(mockPrisma.supplierQuoteToken.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.supplierQuoteToken.create).toHaveBeenCalledTimes(1);
      const revokeArgs = mockPrisma.supplierQuoteToken.updateMany.mock.calls[0][0];
      expect(revokeArgs.where.supplierQuoteId).toBe(supplierQuoteId);
      expect(revokeArgs.where.usedAt).toBeNull();
      expect(revokeArgs.where.revokedAt).toBeNull();
      expect(revokeArgs.data.revokedAt).toBeInstanceOf(Date);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // verifyToken
  // ═══════════════════════════════════════════════════════════
  describe('verifyToken', () => {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const baseRecord = {
      id: 'tok-1',
      tenantId,
      supplierQuoteId,
      requestForQuotationId: rfqId,
      supplierId,
      tokenHash,
      expiresAt: futureDate(1),
      usedAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      accessCount: 0,
    };

    it('rejects empty / too-short tokens with ForbiddenException', async () => {
      await expect(service.verifyToken('')).rejects.toThrow(ForbiddenException);
      await expect(service.verifyToken('short')).rejects.toThrow(ForbiddenException);
    });

    it('rejects unknown tokens', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyToken(rawToken)).rejects.toThrow(ForbiddenException);
    });

    it('rejects revoked tokens', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue({
        ...baseRecord,
        revokedAt: new Date(),
      });
      await expect(service.verifyToken(rawToken)).rejects.toThrow('ลิงก์ถูกยกเลิกแล้ว');
    });

    it('rejects already-used tokens', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue({
        ...baseRecord,
        usedAt: new Date(),
      });
      await expect(service.verifyToken(rawToken)).rejects.toThrow('ลิงก์นี้ถูกใช้ไปแล้ว');
    });

    it('rejects expired tokens', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue({
        ...baseRecord,
        expiresAt: pastDate(1),
      });
      await expect(service.verifyToken(rawToken)).rejects.toThrow('ลิงก์หมดอายุแล้ว');
    });

    it('accepts a valid token and bumps accessCount', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue(baseRecord);
      mockPrisma.supplierQuoteToken.update.mockResolvedValue({});

      const ctx = await service.verifyToken(rawToken);

      expect(ctx).toEqual({
        tokenId: baseRecord.id,
        tenantId,
        supplierQuoteId,
        requestForQuotationId: rfqId,
        supplierId,
        expiresAt: baseRecord.expiresAt,
      });
      expect(mockPrisma.supplierQuoteToken.update).toHaveBeenCalledWith({
        where: { id: baseRecord.id },
        data: {
          lastAccessedAt: expect.any(Date),
          accessCount: { increment: 1 },
        },
      });
    });

    it('looks up by hashed token, never the raw value', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue(baseRecord);
      mockPrisma.supplierQuoteToken.update.mockResolvedValue({});

      await service.verifyToken(rawToken);

      const lookup = mockPrisma.supplierQuoteToken.findUnique.mock.calls[0][0];
      expect(lookup.where.tokenHash).toBe(tokenHash);
      expect(lookup.where.tokenHash).not.toBe(rawToken);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // markTokenUsed — atomic single-submit contract
  // ═══════════════════════════════════════════════════════════
  describe('markTokenUsed', () => {
    it('marks a valid token used (updateMany affects 1 row)', async () => {
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.markTokenUsed('tok-1')).resolves.toBeUndefined();

      const call = mockPrisma.supplierQuoteToken.updateMany.mock.calls[0][0];
      // conditional update — only "still-active" rows get flipped
      expect(call.where).toMatchObject({
        id: 'tok-1',
        usedAt: null,
        revokedAt: null,
      });
      expect(call.data.usedAt).toBeInstanceOf(Date);
    });

    it('throws ForbiddenException when the row was already used (race)', async () => {
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.markTokenUsed('tok-1')).rejects.toThrow(ForbiddenException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // revokeTokensForQuote
  // ═══════════════════════════════════════════════════════════
  describe('revokeTokensForQuote', () => {
    it('returns the number of revoked rows and scopes by tenant', async () => {
      mockPrisma.supplierQuoteToken.updateMany.mockResolvedValue({ count: 3 });
      const n = await service.revokeTokensForQuote(tenantId, supplierQuoteId);

      expect(n).toBe(3);
      const call = mockPrisma.supplierQuoteToken.updateMany.mock.calls[0][0];
      expect(call.where.tenantId).toBe(tenantId);
      expect(call.where.supplierQuoteId).toBe(supplierQuoteId);
      expect(call.where.revokedAt).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // getPortalSession — composed read
  // ═══════════════════════════════════════════════════════════
  describe('getPortalSession', () => {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const tokenRow = {
      id: 'tok-1',
      tenantId,
      supplierQuoteId,
      requestForQuotationId: rfqId,
      supplierId,
      tokenHash,
      expiresAt: futureDate(1),
      usedAt: null,
      revokedAt: null,
    };

    it('throws NotFoundException when quote or RFQ row is missing', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue(tokenRow);
      mockPrisma.supplierQuoteToken.update.mockResolvedValue({});
      mockPrisma.supplierQuote.findFirst.mockResolvedValue(null);
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        rfqNumber: 'RFQ-001',
      });

      await expect(service.getPortalSession(rawToken)).rejects.toThrow(NotFoundException);
    });

    it('returns the shaped session payload when everything resolves', async () => {
      mockPrisma.supplierQuoteToken.findUnique.mockResolvedValue(tokenRow);
      mockPrisma.supplierQuoteToken.update.mockResolvedValue({});
      mockPrisma.supplierQuote.findFirst.mockResolvedValue({
        id: supplierQuoteId,
        status: 'REQUESTED',
        quoteNumber: null,
        currency: 'THB',
        paymentTerms: null,
        deliveryDays: null,
        validUntil: null,
        notes: null,
        totalAmount: '0',
        supplier: { id: supplierId, name: 'Alpha', email: 'a@x.test' },
        purchaseRequisition: {
          id: 'pr-1',
          prNumber: 'PR-001',
          department: 'F&B',
          requiredDate: futureDate(10),
          items: [
            {
              id: 'pri-1',
              itemId: 'item-1',
              quantity: 5,
              item: { id: 'item-1', name: 'Tomato', sku: 'SKU-1', unit: 'KG' },
            },
          ],
        },
        items: [],
      });
      mockPrisma.requestForQuotation.findFirst.mockResolvedValue({
        id: rfqId,
        rfqNumber: 'RFQ-001',
        subject: 'Groceries',
        coverLetter: null,
        customTerms: null,
        deadline: futureDate(7),
        issuedAt: new Date(),
        status: 'SENT',
      });

      const session = (await service.getPortalSession(rawToken)) as {
        token: { expiresAt: Date };
        rfq: { rfqNumber: string };
        supplier: { name: string };
        quote: { id: string };
        purchaseRequisition: { prNumber: string };
        prefillItems: unknown[];
      };

      expect(session.rfq.rfqNumber).toBe('RFQ-001');
      expect(session.supplier.name).toBe('Alpha');
      expect(session.quote.id).toBe(supplierQuoteId);
      expect(session.purchaseRequisition.prNumber).toBe('PR-001');
      expect(Array.isArray(session.prefillItems)).toBe(true);
      expect(session.token.expiresAt).toEqual(tokenRow.expiresAt);
    });
  });
});
