import { Test, TestingModule } from '@nestjs/testing';
import { PromptPayController } from '../../src/promptpay/promptpay.controller';
import { PromptPayService } from '../../src/promptpay/promptpay.service';

describe('PromptPay API', () => {
  let controller: PromptPayController;
  let promptPayService: PromptPayService;

  const mockPromptPayService = {
    generateQRCode: jest.fn(),
    checkPaymentStatus: jest.fn(),
    handleWebhook: jest.fn(),
    verifyPayment: jest.fn(),
    getTransactions: jest.fn(),
    getDailyReconciliation: jest.fn(),
    processRefund: jest.fn(),
  };

  const mockUser = {
    sub: 'user-123',
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromptPayController],
      providers: [
        {
          provide: PromptPayService,
          useValue: mockPromptPayService,
        },
      ],
    }).compile();

    controller = module.get<PromptPayController>(PromptPayController);
    promptPayService = module.get<PromptPayService>(PromptPayService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/v1/payments/promptpay/generate-qr', () => {
    it('should generate QR code for payment', async () => {
      const dto = {
        amount: 1500.00,
        reference: 'BOOK-123',
        description: 'ค่าห้องพัก 1 คืน',
      };

      const mockResult = {
        success: true,
        transactionRef: 'TXN-123456',
        qrCodeData: 'data:image/png;base64,...',
        qrCodeString: '00020101021229...',
        amount: 1500.00,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };

      mockPromptPayService.generateQRCode.mockResolvedValue(mockResult);

      const result = await controller.generateQRCode(dto, { user: mockUser });

      expect(promptPayService.generateQRCode).toHaveBeenCalledWith({
        ...dto,
        tenantId: mockUser.tenantId,
      });
      expect(result).toEqual(mockResult);
    });

    it('should generate QR code with booking reference', async () => {
      const dto = {
        amount: 2500.00,
        bookingId: 'booking-456',
        reference: 'INV-001',
      };

      mockPromptPayService.generateQRCode.mockResolvedValue({
        success: true,
        transactionRef: 'TXN-789',
      });

      await controller.generateQRCode(dto, { user: mockUser });

      expect(promptPayService.generateQRCode).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'booking-456' }),
      );
    });

    it('should handle invalid amount', async () => {
      const dto = {
        amount: -100,
        reference: 'TEST',
      };

      mockPromptPayService.generateQRCode.mockRejectedValue(
        new Error('Amount must be positive'),
      );

      await expect(controller.generateQRCode(dto, { user: mockUser })).rejects.toThrow(
        'Amount must be positive',
      );
    });
  });

  describe('GET /api/v1/payments/promptpay/status/:transactionRef', () => {
    it('should check payment status - pending', async () => {
      const transactionRef = 'TXN-123456';

      const mockStatus = {
        transactionRef,
        status: 'pending',
        amount: 1500.00,
        createdAt: new Date().toISOString(),
      };

      mockPromptPayService.checkPaymentStatus.mockResolvedValue(mockStatus);

      const result = await controller.checkStatus(transactionRef);

      expect(promptPayService.checkPaymentStatus).toHaveBeenCalledWith(transactionRef);
      expect(result.status).toBe('pending');
    });

    it('should check payment status - completed', async () => {
      const transactionRef = 'TXN-123456';

      const mockStatus = {
        transactionRef,
        status: 'completed',
        amount: 1500.00,
        paidAt: new Date().toISOString(),
        payerInfo: {
          bankCode: '004',
          accountLastDigits: '1234',
        },
      };

      mockPromptPayService.checkPaymentStatus.mockResolvedValue(mockStatus);

      const result = await controller.checkStatus(transactionRef);

      expect(result.status).toBe('completed');
      expect(result.payerInfo).toBeDefined();
    });

    it('should handle non-existent transaction', async () => {
      const transactionRef = 'INVALID-REF';

      mockPromptPayService.checkPaymentStatus.mockRejectedValue(
        new Error('Transaction not found'),
      );

      await expect(controller.checkStatus(transactionRef)).rejects.toThrow(
        'Transaction not found',
      );
    });
  });

  describe('POST /api/v1/payments/promptpay/webhook', () => {
    it('should handle successful payment webhook', async () => {
      const webhookDto = {
        transactionRef: 'TXN-123456',
        status: 'SUCCESS',
        amount: 1500.00,
        paidAt: new Date().toISOString(),
        signature: 'valid-signature',
      };

      const mockResult = {
        success: true,
        message: 'Payment processed',
      };

      mockPromptPayService.handleWebhook.mockResolvedValue(mockResult);

      const result = await controller.handleWebhook(webhookDto);

      expect(promptPayService.handleWebhook).toHaveBeenCalledWith(webhookDto);
      expect(result.success).toBe(true);
    });

    it('should handle failed payment webhook', async () => {
      const webhookDto = {
        transactionRef: 'TXN-123456',
        status: 'FAILED',
        errorCode: 'INSUFFICIENT_FUNDS',
        signature: 'valid-signature',
      };

      mockPromptPayService.handleWebhook.mockResolvedValue({
        success: true,
        message: 'Payment failed - recorded',
      });

      await controller.handleWebhook(webhookDto);

      expect(promptPayService.handleWebhook).toHaveBeenCalled();
    });

    it('should reject invalid webhook signature', async () => {
      const webhookDto = {
        transactionRef: 'TXN-123456',
        status: 'SUCCESS',
        signature: 'invalid-signature',
      };

      mockPromptPayService.handleWebhook.mockRejectedValue(
        new Error('Invalid webhook signature'),
      );

      await expect(controller.handleWebhook(webhookDto)).rejects.toThrow(
        'Invalid webhook signature',
      );
    });
  });

  describe('POST /api/v1/payments/promptpay/verify', () => {
    it('should manually verify a payment', async () => {
      const dto = { transactionRef: 'TXN-123456' };

      const mockResult = {
        success: true,
        transactionRef: 'TXN-123456',
        status: 'completed',
        verifiedBy: 'user-123',
        verifiedAt: new Date().toISOString(),
      };

      mockPromptPayService.verifyPayment.mockResolvedValue(mockResult);

      const result = await controller.verifyPayment(dto, { user: mockUser });

      expect(promptPayService.verifyPayment).toHaveBeenCalledWith('TXN-123456', 'user-123');
      expect(result.verifiedBy).toBe('user-123');
    });
  });

  describe('GET /api/v1/payments/promptpay/transactions', () => {
    it('should get transaction list with pagination', async () => {
      const query = {
        page: 1,
        limit: 10,
        status: 'completed',
      };

      const mockTransactions = {
        data: [
          { transactionRef: 'TXN-1', amount: 1500, status: 'completed' },
          { transactionRef: 'TXN-2', amount: 2500, status: 'completed' },
        ],
        total: 2,
        page: 1,
        limit: 10,
      };

      mockPromptPayService.getTransactions.mockResolvedValue(mockTransactions);

      const result = await controller.getTransactions(query, { user: mockUser });

      expect(promptPayService.getTransactions).toHaveBeenCalledWith(query, mockUser.tenantId);
      expect(result.data.length).toBe(2);
    });

    it('should filter by date range', async () => {
      const query = {
        page: 1,
        limit: 20,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      mockPromptPayService.getTransactions.mockResolvedValue({ data: [], total: 0 });

      await controller.getTransactions(query, { user: mockUser });

      expect(promptPayService.getTransactions).toHaveBeenCalledWith(query, mockUser.tenantId);
    });
  });

  describe('GET /api/v1/payments/promptpay/reconciliation/:date', () => {
    it('should get daily reconciliation report', async () => {
      const date = '2024-01-15';

      const mockReport = {
        summary: {
          date,
          totalTransactions: 25,
          totalAmount: 125000.00,
          paidCount: 23,
          paidAmount: 120000.00,
          pendingCount: 0,
          pendingAmount: 0,
          expiredCount: 2,
          expiredAmount: 5000.00,
          failedCount: 0,
          failedAmount: 0,
        },
        transactions: [],
      };

      mockPromptPayService.getDailyReconciliation.mockResolvedValue(mockReport);

      const result = await controller.getReconciliation(date, { user: mockUser });

      expect(promptPayService.getDailyReconciliation).toHaveBeenCalledWith(date, mockUser.tenantId);
      expect(result.summary.totalTransactions).toBe(25);
    });
  });

  describe('POST /api/v1/payments/promptpay/refund', () => {
    it('should process refund request', async () => {
      const dto = {
        transactionRef: 'TXN-123456',
        amount: 1000.00,
        reason: 'Customer cancellation',
      };

      const mockResult = {
        success: true,
        refundRef: 'REF-789',
        originalTransaction: 'TXN-123456',
        refundAmount: 1000.00,
        status: 'processing',
      };

      mockPromptPayService.processRefund.mockResolvedValue(mockResult);

      const result = await controller.processRefund(dto, { user: mockUser });

      expect(promptPayService.processRefund).toHaveBeenCalledWith(dto, 'user-123');
      expect(result.refundRef).toBeDefined();
    });

    it('should handle partial refund', async () => {
      const dto = {
        transactionRef: 'TXN-123456',
        amount: 500.00,
        reason: 'Partial refund - room change',
      };

      mockPromptPayService.processRefund.mockResolvedValue({
        success: true,
        refundAmount: 500.00,
        originalAmount: 1500.00,
      });

      const result = await controller.processRefund(dto, { user: mockUser });

      expect(result.refundAmount).toBe(500.00);
    });

    it('should reject refund exceeding original amount', async () => {
      const dto = {
        transactionRef: 'TXN-123456',
        amount: 10000.00,
        reason: 'Test',
      };

      mockPromptPayService.processRefund.mockRejectedValue(
        new Error('Refund amount exceeds original transaction'),
      );

      await expect(controller.processRefund(dto, { user: mockUser })).rejects.toThrow(
        'Refund amount exceeds original transaction',
      );
    });
  });
});
