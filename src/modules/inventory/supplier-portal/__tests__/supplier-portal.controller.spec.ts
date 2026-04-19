import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplierPortalController } from '../supplier-portal.controller';
import { SupplierPortalService } from '../supplier-portal.service';
import { SupplierQuotesService } from '../../supplier-quotes/supplier-quotes.service';
import { SubmitQuoteDto } from '../../supplier-quotes/dto';

/**
 * Controller-level tests — we mock both services and assert orchestration:
 *   getSession  → verifyToken + getPortalSession + envelope
 *   submit      → verifyToken → submitQuote → markTokenUsed (in order)
 */
describe('SupplierPortalController', () => {
  let controller: SupplierPortalController;

  const portalService = {
    verifyToken: jest.fn(),
    getPortalSession: jest.fn(),
    markTokenUsed: jest.fn(),
  };

  const quotesService = {
    submitQuote: jest.fn(),
  };

  const RAW_TOKEN = 'a'.repeat(43); // base64url-ish, > 32 chars

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [SupplierPortalController],
      providers: [
        { provide: SupplierPortalService, useValue: portalService },
        { provide: SupplierQuotesService, useValue: quotesService },
      ],
    }).compile();

    controller = mod.get<SupplierPortalController>(SupplierPortalController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // GET /supplier-portal/session
  // ═══════════════════════════════════════════════════════════
  describe('getSession', () => {
    it('rejects an empty token with BadRequestException', async () => {
      await expect(controller.getSession('')).rejects.toThrow(BadRequestException);
      expect(portalService.getPortalSession).not.toHaveBeenCalled();
    });

    it('returns the service payload wrapped in the success envelope', async () => {
      const payload = { rfq: { rfqNumber: 'RFQ-123' } };
      portalService.getPortalSession.mockResolvedValue(payload);

      const res = await controller.getSession(RAW_TOKEN);

      expect(res).toEqual({ success: true, data: payload });
      expect(portalService.getPortalSession).toHaveBeenCalledWith(RAW_TOKEN);
    });

    it('propagates ForbiddenException from invalid tokens', async () => {
      portalService.getPortalSession.mockRejectedValue(new ForbiddenException('ลิงก์หมดอายุแล้ว'));
      await expect(controller.getSession(RAW_TOKEN)).rejects.toThrow(ForbiddenException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // POST /supplier-portal/submit
  // ═══════════════════════════════════════════════════════════
  describe('submit', () => {
    const dto: SubmitQuoteDto = {
      items: [
        {
          itemId: '00000000-0000-0000-0000-000000000000',
          quantity: 1,
          unitPrice: 100,
        },
      ],
    } as SubmitQuoteDto;

    const ctx = {
      tokenId: 'tok-1',
      tenantId: 'tenant-1',
      supplierQuoteId: 'sq-1',
      requestForQuotationId: 'rfq-1',
      supplierId: 'sup-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    };

    it('rejects an empty token with BadRequestException', async () => {
      await expect(controller.submit('', dto)).rejects.toThrow(BadRequestException);
      expect(portalService.verifyToken).not.toHaveBeenCalled();
    });

    it('verifies token → persists quote → burns token, in that order', async () => {
      const calls: string[] = [];
      portalService.verifyToken.mockImplementation(async () => {
        calls.push('verify');
        return ctx;
      });
      quotesService.submitQuote.mockImplementation(async () => {
        calls.push('submit');
        return undefined;
      });
      portalService.markTokenUsed.mockImplementation(async () => {
        calls.push('burn');
      });

      const res = await controller.submit(RAW_TOKEN, dto);

      expect(calls).toEqual(['verify', 'submit', 'burn']);
      expect(quotesService.submitQuote).toHaveBeenCalledWith(
        ctx.supplierQuoteId,
        dto,
        ctx.tenantId,
      );
      expect(portalService.markTokenUsed).toHaveBeenCalledWith(ctx.tokenId);
      expect(res).toEqual({
        success: true,
        data: { quoteId: ctx.supplierQuoteId },
      });
    });

    it('does NOT burn the token if the quote submission fails', async () => {
      portalService.verifyToken.mockResolvedValue(ctx);
      quotesService.submitQuote.mockRejectedValue(new BadRequestException('validation failed'));

      await expect(controller.submit(RAW_TOKEN, dto)).rejects.toThrow(BadRequestException);
      expect(portalService.markTokenUsed).not.toHaveBeenCalled();
    });

    it('surfaces ForbiddenException when the token is already used / revoked', async () => {
      portalService.verifyToken.mockRejectedValue(new ForbiddenException('ลิงก์นี้ถูกใช้ไปแล้ว'));

      await expect(controller.submit(RAW_TOKEN, dto)).rejects.toThrow(ForbiddenException);
      expect(quotesService.submitQuote).not.toHaveBeenCalled();
      expect(portalService.markTokenUsed).not.toHaveBeenCalled();
    });
  });
});
