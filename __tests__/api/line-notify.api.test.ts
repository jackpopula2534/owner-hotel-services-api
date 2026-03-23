import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { LineNotifyController } from '../../src/line-notify/line-notify.controller';
import { LineNotifyService } from '../../src/line-notify/line-notify.service';
import { LineNotifyEventType } from '../../src/line-notify/dto/line-notify.dto';

describe('Line Notify API', () => {
  let controller: LineNotifyController;
  let lineNotifyService: LineNotifyService;

  const mockLineNotifyService = {
    getAuthorizationUrl: jest.fn(),
    exchangeCodeForToken: jest.fn(),
    getTokenStatus: jest.fn(),
    saveToken: jest.fn(),
    getStatus: jest.fn(),
    updatePreferences: jest.fn(),
    disconnect: jest.fn(),
    sendNotification: jest.fn(),
    sendToTenant: jest.fn(),
    getTenantTokens: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LineNotifyController],
      providers: [
        {
          provide: LineNotifyService,
          useValue: mockLineNotifyService,
        },
      ],
    }).compile();

    controller = module.get<LineNotifyController>(LineNotifyController);
    lineNotifyService = module.get<LineNotifyService>(LineNotifyService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/line-notify/connect', () => {
    it('should return authorization URL', () => {
      const mockAuthUrl = 'https://notify-bot.line.me/oauth/authorize?...';

      mockLineNotifyService.getAuthorizationUrl.mockReturnValue(mockAuthUrl);

      const result = controller.getAuthUrl(mockUser);

      expect(lineNotifyService.getAuthorizationUrl).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
      );
      expect(result.authUrl).toBe(mockAuthUrl);
    });
  });

  describe('GET /api/v1/line-notify/callback', () => {
    it('should handle OAuth callback successfully', async () => {
      const code = 'auth-code-123';
      const state = Buffer.from(JSON.stringify({ tenantId: 'tenant-123', userId: 'user-123' })).toString('base64');

      mockLineNotifyService.exchangeCodeForToken.mockResolvedValue({
        access_token: 'line-token-xyz',
      });
      mockLineNotifyService.getTokenStatus.mockResolvedValue({
        target: 'Test Group',
        targetType: 'GROUP',
      });
      mockLineNotifyService.saveToken.mockResolvedValue(undefined);

      const mockResponse = {
        redirect: jest.fn(),
      } as unknown as Response;

      await controller.callback(code, state, mockResponse);

      expect(lineNotifyService.exchangeCodeForToken).toHaveBeenCalledWith(code);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/line-notify/success?connected=true');
    });

    it('should handle OAuth callback error', async () => {
      const code = 'invalid-code';
      const state = Buffer.from(JSON.stringify({ tenantId: 'tenant-123', userId: 'user-123' })).toString('base64');

      mockLineNotifyService.exchangeCodeForToken.mockRejectedValue(
        new Error('Invalid authorization code'),
      );

      const mockResponse = {
        redirect: jest.fn(),
      } as unknown as Response;

      await controller.callback(code, state, mockResponse);

      expect(mockResponse.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/line-notify/error?message='),
      );
    });
  });

  describe('GET /api/v1/line-notify/status', () => {
    it('should return connected status', async () => {
      const mockStatus = {
        isConnected: true,
        targetName: 'Hotel Staff Group',
        targetType: 'GROUP',
        connectedAt: '2024-01-15T10:00:00Z',
        enabledEvents: ['booking_created', 'booking_cancelled', 'payment_received'],
      };

      mockLineNotifyService.getStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus(mockUser);

      expect(lineNotifyService.getStatus).toHaveBeenCalledWith('tenant-123', 'user-123');
      expect(result.isConnected).toBe(true);
      expect(result.targetName).toBe('Hotel Staff Group');
    });

    it('should return disconnected status', async () => {
      const mockStatus = {
        isConnected: false,
        targetName: null,
        targetType: null,
        connectedAt: null,
        enabledEvents: null,
      };

      mockLineNotifyService.getStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus(mockUser);

      expect(result.isConnected).toBe(false);
    });
  });

  describe('POST /api/v1/line-notify/preferences', () => {
    it('should update notification preferences', async () => {
      const dto = {
        enabledEvents: [
          LineNotifyEventType.BOOKING_CREATED,
          LineNotifyEventType.BOOKING_CANCELLED,
          LineNotifyEventType.BOOKING_CHECKIN,
          LineNotifyEventType.BOOKING_CHECKOUT,
          LineNotifyEventType.PAYMENT_RECEIVED,
          LineNotifyEventType.DAILY_SUMMARY,
          LineNotifyEventType.SYSTEM_ALERT,
        ],
      };

      mockLineNotifyService.updatePreferences.mockResolvedValue(undefined);

      const result = await controller.updatePreferences(mockUser, dto);

      expect(lineNotifyService.updatePreferences).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        dto,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('GET /api/v1/line-notify/event-types', () => {
    it('should return available event types', () => {
      const result = controller.getEventTypes();

      expect(result.eventTypes).toBeDefined();
      expect(Array.isArray(result.eventTypes)).toBe(true);
      expect(result.eventTypes.length).toBeGreaterThan(0);

      const bookingCreated = result.eventTypes.find(e => e.key === 'BOOKING_CREATED');
      expect(bookingCreated).toBeDefined();
      expect(bookingCreated?.label).toBe('New Booking');
      expect(bookingCreated?.labelTh).toBe('การจองใหม่');
    });
  });

  describe('DELETE /api/v1/line-notify/disconnect', () => {
    it('should disconnect Line Notify', async () => {
      mockLineNotifyService.disconnect.mockResolvedValue(undefined);

      const result = await controller.disconnect(mockUser);

      expect(lineNotifyService.disconnect).toHaveBeenCalledWith('tenant-123', 'user-123');
      expect(result.success).toBe(true);
    });
  });

  describe('POST /api/v1/line-notify/test', () => {
    it('should send test notification', async () => {
      mockLineNotifyService.sendNotification.mockResolvedValue(true);

      const result = await controller.sendTest(mockUser);

      expect(lineNotifyService.sendNotification).toHaveBeenCalledWith(
        'tenant-123',
        'user-123',
        expect.objectContaining({
          message: expect.stringContaining('ทดสอบการแจ้งเตือน'),
        }),
      );
      expect(result.success).toBe(true);
    });

    it('should handle failed test notification', async () => {
      mockLineNotifyService.sendNotification.mockResolvedValue(false);

      const result = await controller.sendTest(mockUser);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to send notification');
    });
  });

  describe('POST /api/v1/line-notify/send', () => {
    it('should send custom notification to tenant', async () => {
      const dto = {
        message: 'Important announcement for all staff',
      };

      mockLineNotifyService.sendToTenant.mockResolvedValue(5);

      const result = await controller.sendNotification(mockUser, dto);

      expect(lineNotifyService.sendToTenant).toHaveBeenCalledWith('tenant-123', dto);
      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(5);
    });

    it('should handle no connected users', async () => {
      const dto = {
        message: 'Test message',
      };

      mockLineNotifyService.sendToTenant.mockResolvedValue(0);

      const result = await controller.sendNotification(mockUser, dto);

      expect(result.success).toBe(false);
      expect(result.sentCount).toBe(0);
    });
  });

  describe('GET /api/v1/line-notify/users', () => {
    it('should get all connected users for tenant', async () => {
      const mockUsers = [
        {
          userId: 'user-1',
          targetName: 'Staff 1',
          targetType: 'USER',
          connectedAt: '2024-01-10T10:00:00Z',
        },
        {
          userId: 'user-2',
          targetName: 'Manager Group',
          targetType: 'GROUP',
          connectedAt: '2024-01-15T10:00:00Z',
        },
      ];

      mockLineNotifyService.getTenantTokens.mockResolvedValue(mockUsers);

      const result = await controller.getConnectedUsers(mockUser);

      expect(lineNotifyService.getTenantTokens).toHaveBeenCalledWith('tenant-123');
      expect(result).toHaveLength(2);
    });
  });

  describe('GET /api/v1/line-notify/success', () => {
    it('should render success page', () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      controller.success(mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('เชื่อมต่อ Line Notify สำเร็จ'),
      );
    });
  });

  describe('GET /api/v1/line-notify/error', () => {
    it('should render error page with message', () => {
      const message = 'Connection timeout';

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      controller.error(message, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining('เชื่อมต่อ Line Notify ไม่สำเร็จ'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });
  });
});
