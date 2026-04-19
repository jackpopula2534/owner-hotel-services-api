import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export interface GeneratedTokenResult {
  supplierQuoteId: string;
  supplierId: string;
  supplierEmail: string | null;
  supplierName: string;
  rawToken: string;
  portalUrl: string;
  expiresAt: Date;
}

export interface VerifiedTokenContext {
  tokenId: string;
  tenantId: string;
  supplierQuoteId: string;
  requestForQuotationId: string;
  supplierId: string;
  expiresAt: Date;
}

/**
 * Manages short-lived access tokens emailed to suppliers so they can
 * submit / update their quote via the public supplier portal without
 * needing a StaySync login.
 *
 * Tokens are stored hashed (sha256); the raw value only lives long enough
 * to embed in the outgoing email link. Expiry is pinned to RFQ.deadline.
 */
@Injectable()
export class SupplierPortalService {
  private readonly logger = new Logger(SupplierPortalService.name);
  private static readonly TOKEN_BYTES = 32;
  private static readonly FALLBACK_EXPIRY_DAYS = 14;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generate one token per (supplier × RFQ). If quotes already exist
   * (sprouted skeletons), we attach to the first REQUESTED quote for that
   * supplier. Returns only recipients with an email so callers can send.
   *
   * Idempotent per send: existing non-revoked tokens for the same
   * (rfq, supplier) are revoked first.
   */
  async generateTokensForRfq(tenantId: string, rfqId: string): Promise<GeneratedTokenResult[]> {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id: rfqId, tenantId },
      include: {
        recipients: { include: { supplier: true } },
        supplierQuotes: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            round: true,
          },
        },
      },
    });

    if (!rfq) {
      throw new NotFoundException('ไม่พบ RFQ');
    }

    const expiresAt = this.resolveExpiry(rfq.deadline);
    const baseUrl = this.resolvePortalBaseUrl();
    const out: GeneratedTokenResult[] = [];

    for (const recipient of rfq.recipients) {
      const quote = rfq.supplierQuotes.find(
        (q) => q.supplierId === recipient.supplierId && q.round === rfq.round,
      );
      if (!quote) {
        this.logger.warn(
          `No skeleton quote found for supplier ${recipient.supplierId} on rfq ${rfqId}`,
        );
        continue;
      }

      // Revoke any previously-active tokens so only the newest link works
      await this.prisma.supplierQuoteToken.updateMany({
        where: {
          supplierQuoteId: quote.id,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      const rawToken = this.generateRawToken();
      await this.prisma.supplierQuoteToken.create({
        data: {
          tenantId,
          supplierQuoteId: quote.id,
          requestForQuotationId: rfqId,
          supplierId: recipient.supplierId,
          tokenHash: this.hashToken(rawToken),
          expiresAt,
        },
      });

      out.push({
        supplierQuoteId: quote.id,
        supplierId: recipient.supplierId,
        supplierEmail: recipient.supplier.email ?? null,
        supplierName: recipient.supplier.name,
        rawToken,
        portalUrl: this.buildPortalUrl(baseUrl, rawToken),
        expiresAt,
      });
    }

    return out;
  }

  /**
   * Regenerate a single supplier's token (revoke old → create new).
   * Used by admin "resend invitation" action.
   */
  async regenerateTokenForSupplier(
    tenantId: string,
    rfqId: string,
    supplierId: string,
  ): Promise<GeneratedTokenResult> {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id: rfqId, tenantId },
      include: {
        recipients: {
          where: { supplierId },
          include: { supplier: true },
        },
        supplierQuotes: {
          where: { supplierId },
          select: { id: true, supplierId: true, round: true, status: true },
        },
      },
    });

    if (!rfq) throw new NotFoundException('ไม่พบ RFQ');
    const recipient = rfq.recipients[0];
    if (!recipient) {
      throw new NotFoundException('ซัพพลายเออร์นี้ไม่ได้อยู่ในรายชื่อผู้รับ RFQ');
    }
    const quote = rfq.supplierQuotes.find((q) => q.round === rfq.round);
    if (!quote) {
      throw new BadRequestException('ยังไม่มี Supplier Quote skeleton สำหรับ supplier นี้');
    }

    const expiresAt = this.resolveExpiry(rfq.deadline);
    const baseUrl = this.resolvePortalBaseUrl();

    await this.prisma.supplierQuoteToken.updateMany({
      where: {
        supplierQuoteId: quote.id,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const rawToken = this.generateRawToken();
    await this.prisma.supplierQuoteToken.create({
      data: {
        tenantId,
        supplierQuoteId: quote.id,
        requestForQuotationId: rfqId,
        supplierId,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
      },
    });

    return {
      supplierQuoteId: quote.id,
      supplierId,
      supplierEmail: recipient.supplier.email ?? null,
      supplierName: recipient.supplier.name,
      rawToken,
      portalUrl: this.buildPortalUrl(baseUrl, rawToken),
      expiresAt,
    };
  }

  /**
   * Validate a raw token against DB. Throws if missing / expired / used /
   * revoked. On success: records lastAccessedAt + increments accessCount.
   */
  async verifyToken(rawToken: string): Promise<VerifiedTokenContext> {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
      throw new ForbiddenException('ลิงก์ไม่ถูกต้อง');
    }
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.supplierQuoteToken.findUnique({
      where: { tokenHash },
    });
    if (!record) {
      throw new ForbiddenException('ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว');
    }
    if (record.revokedAt) {
      throw new ForbiddenException('ลิงก์ถูกยกเลิกแล้ว');
    }
    if (record.usedAt) {
      throw new ForbiddenException('ลิงก์นี้ถูกใช้ไปแล้ว');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('ลิงก์หมดอายุแล้ว');
    }

    await this.prisma.supplierQuoteToken.update({
      where: { id: record.id },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });

    return {
      tokenId: record.id,
      tenantId: record.tenantId,
      supplierQuoteId: record.supplierQuoteId,
      requestForQuotationId: record.requestForQuotationId,
      supplierId: record.supplierId,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Mark a token as used (call after a successful quote submission).
   * Uses a conditional update so a race between two concurrent submits
   * can't both succeed.
   */
  async markTokenUsed(tokenId: string): Promise<void> {
    const result = await this.prisma.supplierQuoteToken.updateMany({
      where: { id: tokenId, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ForbiddenException('ลิงก์ถูกใช้ไปแล้ว');
    }
  }

  /**
   * Revoke all active tokens for a quote (used by "reopen" flow so old
   * links from the previous submission can't be reused).
   */
  async revokeTokensForQuote(tenantId: string, supplierQuoteId: string): Promise<number> {
    const res = await this.prisma.supplierQuoteToken.updateMany({
      where: {
        tenantId,
        supplierQuoteId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /**
   * Load the data the public portal needs to render: RFQ header, supplier
   * contact, quote skeleton, and the PR line items the supplier must price.
   */
  async getPortalSession(token: string): Promise<unknown> {
    const ctx = await this.verifyToken(token);

    const [quote, rfq] = await Promise.all([
      this.prisma.supplierQuote.findFirst({
        where: { id: ctx.supplierQuoteId, tenantId: ctx.tenantId },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              email: true,
              contactPerson: true,
              phone: true,
            },
          },
          purchaseRequisition: {
            select: {
              id: true,
              prNumber: true,
              department: true,
              requiredDate: true,
              items: {
                select: {
                  id: true,
                  itemId: true,
                  quantity: true,
                  item: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      unit: true,
                    },
                  },
                },
              },
            },
          },
          items: {
            select: {
              id: true,
              itemId: true,
              quantity: true,
              unitPrice: true,
              discount: true,
              taxRate: true,
              leadTimeDays: true,
              notes: true,
            },
          },
        },
      }),
      this.prisma.requestForQuotation.findFirst({
        where: { id: ctx.requestForQuotationId, tenantId: ctx.tenantId },
        select: {
          id: true,
          rfqNumber: true,
          subject: true,
          coverLetter: true,
          customTerms: true,
          deadline: true,
          issuedAt: true,
          status: true,
        },
      }),
    ]);

    if (!quote || !rfq) {
      throw new NotFoundException('ไม่พบข้อมูลใบเสนอราคา');
    }

    return {
      token: { expiresAt: ctx.expiresAt },
      rfq,
      supplier: quote.supplier,
      quote: {
        id: quote.id,
        status: quote.status,
        quoteNumber: quote.quoteNumber,
        currency: quote.currency,
        paymentTerms: quote.paymentTerms,
        deliveryDays: quote.deliveryDays,
        validUntil: quote.validUntil,
        notes: quote.notes,
        totalAmount: quote.totalAmount,
      },
      purchaseRequisition: quote.purchaseRequisition,
      // Prefill from existing quote items (so supplier can edit after reopen)
      prefillItems: quote.items,
    };
  }

  // ── private helpers ────────────────────────────────────────────

  private generateRawToken(): string {
    return crypto.randomBytes(SupplierPortalService.TOKEN_BYTES).toString('base64url');
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private resolveExpiry(rfqDeadline: Date | null): Date {
    if (rfqDeadline && rfqDeadline.getTime() > Date.now()) {
      return rfqDeadline;
    }
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + SupplierPortalService.FALLBACK_EXPIRY_DAYS);
    return fallback;
  }

  private resolvePortalBaseUrl(): string {
    const url =
      this.configService.get<string>('FRONTEND_URL') ??
      this.configService.get<string>('APP_BASE_URL') ??
      'http://localhost:9010';
    return url.replace(/\/$/, '');
  }

  private buildPortalUrl(baseUrl: string, rawToken: string): string {
    const encoded = encodeURIComponent(rawToken);
    return `${baseUrl}/supplier-portal/quote?token=${encoded}`;
  }
}

// Helper for callers who only need to hash
export function hashSupplierPortalToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Re-exported so tests can introspect without importing Prisma namespace
export type SupplierQuoteTokenCreateInput = Prisma.SupplierQuoteTokenCreateInput;
