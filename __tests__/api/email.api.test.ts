import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from '../../src/email/email.controller';
import { EmailService } from '../../src/email/email.service';
import { EmailTemplate } from '../../src/email/dto/send-email.dto';

describe('Email API', () => {
  let controller: EmailController;
  let emailService: EmailService;

  const mockEmailService = {
    sendEmail: jest.fn(),
    sendBulkEmail: jest.fn(),
    getEmailHistory: jest.fn(),
    getTemplateList: jest.fn(),
    resendEmail: jest.fn(),
  };

  const mockUser = {
    sub: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
    firstName: 'Test',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
    emailService = module.get<EmailService>(EmailService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/v1/notifications/email/send', () => {
    it('should send a single email', async () => {
      const dto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        template: EmailTemplate.BOOKING_CONFIRMATION,
        context: { guestName: 'John' },
      };

      const mockResult = {
        success: true,
        messageId: 'msg-123',
      };

      mockEmailService.sendEmail.mockResolvedValue(mockResult);

      const result = await controller.sendEmail(dto, { user: mockUser });

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        ...dto,
        tenantId: mockUser.tenantId,
      });
      expect(result).toEqual(mockResult);
    });

    it('should use tenantId from dto if provided', async () => {
      const dto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        template: EmailTemplate.WELCOME,
        context: {},
        tenantId: 'custom-tenant-123',
      };

      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      await controller.sendEmail(dto, { user: mockUser });

      expect(emailService.sendEmail).toHaveBeenCalledWith({
        ...dto,
        tenantId: 'custom-tenant-123',
      });
    });
  });

  describe('POST /api/v1/notifications/email/send-bulk', () => {
    it('should send bulk emails', async () => {
      const dto = {
        recipients: [
          { to: 'user1@example.com', context: { name: 'User 1' } },
          { to: 'user2@example.com', context: { name: 'User 2' } },
        ],
        subject: 'Bulk Email',
        template: EmailTemplate.WELCOME,
      };

      const mockResult = {
        success: true,
        sent: 2,
        failed: 0,
      };

      mockEmailService.sendBulkEmail.mockResolvedValue(mockResult);

      const result = await controller.sendBulkEmail(dto, { user: mockUser });

      expect(emailService.sendBulkEmail).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should handle partial failures in bulk send', async () => {
      const dto = {
        recipients: [
          { to: 'valid@example.com', context: {} },
          { to: 'invalid-email', context: {} },
        ],
        subject: 'Test',
        template: EmailTemplate.WELCOME,
      } as import('../../src/email/dto/send-email.dto').SendBulkEmailDto;

      const mockResult = {
        success: true,
        count: 1,
        emailLogIds: ['log-1'],
      };

      mockEmailService.sendBulkEmail.mockResolvedValue(mockResult);

      const result = await controller.sendBulkEmail(dto, { user: mockUser });

      expect(result.count).toBe(1);
    });
  });

  describe('GET /api/v1/notifications/email/history', () => {
    it('should get email history with pagination', async () => {
      const query = {
        page: 1,
        limit: 10,
      };

      const mockHistory = {
        data: [
          { id: '1', to: 'user@example.com', subject: 'Test', status: 'sent' },
        ],
        total: 1,
        page: 1,
        limit: 10,
      };

      mockEmailService.getEmailHistory.mockResolvedValue(mockHistory);

      const result = await controller.getEmailHistory(query, { user: mockUser });

      expect(emailService.getEmailHistory).toHaveBeenCalledWith(query, mockUser.tenantId);
      expect(result).toEqual(mockHistory);
    });

    it('should allow platform_admin to see all tenant emails', async () => {
      const platformAdmin = { ...mockUser, role: 'platform_admin' };
      const query = { page: 1, limit: 10 };

      await controller.getEmailHistory(query, { user: platformAdmin });

      expect(emailService.getEmailHistory).toHaveBeenCalledWith(query, undefined);
    });

    it('should filter by date range', async () => {
      const query = {
        page: 1,
        limit: 10,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      mockEmailService.getEmailHistory.mockResolvedValue({ data: [], total: 0 });

      await controller.getEmailHistory(query, { user: mockUser });

      expect(emailService.getEmailHistory).toHaveBeenCalledWith(query, mockUser.tenantId);
    });
  });

  describe('GET /api/v1/notifications/email/templates', () => {
    it('should get available email templates', async () => {
      const mockTemplates = [
        { id: 'welcome', name: 'Welcome Email', description: 'Sent to new users' },
        { id: 'booking_confirmation', name: 'Booking Confirmation', description: 'Booking confirmed' },
        { id: 'password_reset', name: 'Password Reset', description: 'Reset password link' },
      ];

      mockEmailService.getTemplateList.mockResolvedValue(mockTemplates);

      const result = await controller.getTemplates();

      expect(emailService.getTemplateList).toHaveBeenCalled();
      expect(result).toEqual(mockTemplates);
      expect(result.length).toBe(3);
    });
  });

  describe('POST /api/v1/notifications/email/resend', () => {
    it('should resend a failed email', async () => {
      const dto = { emailLogId: 'email-log-123' };

      const mockResult = {
        success: true,
        messageId: 'new-msg-123',
      };

      mockEmailService.resendEmail.mockResolvedValue(mockResult);

      const result = await controller.resendEmail(dto);

      expect(emailService.resendEmail).toHaveBeenCalledWith('email-log-123');
      expect(result).toEqual(mockResult);
    });

    it('should handle non-existent email log', async () => {
      const dto = { emailLogId: 'non-existent' };

      mockEmailService.resendEmail.mockRejectedValue(new Error('Email log not found'));

      await expect(controller.resendEmail(dto)).rejects.toThrow('Email log not found');
    });
  });

  describe('POST /api/v1/notifications/email/test', () => {
    it('should send test email to specified address', async () => {
      const body = { email: 'test@example.com' };

      mockEmailService.sendEmail.mockResolvedValue({ success: true });

      const result = await controller.sendTestEmail(body, { user: mockUser });

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Email - ทดสอบอีเมล',
          template: 'welcome',
        }),
      );
      expect(result).toEqual({ success: true });
    });
  });
});
