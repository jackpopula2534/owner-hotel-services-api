import { Test, TestingModule } from '@nestjs/testing';
import { PushNotificationsController } from '../../src/push-notifications/push-notifications.controller';
import { PushNotificationsService } from '../../src/push-notifications/push-notifications.service';
import { DevicePlatform } from '../../src/push-notifications/dto/push-notification.dto';

describe('Push Notifications API', () => {
  let controller: PushNotificationsController;
  let pushNotificationsService: PushNotificationsService;

  const mockPushNotificationsService = {
    isAvailable: jest.fn(),
    registerDevice: jest.fn(),
    unregisterDevice: jest.fn(),
    getUserDevices: jest.fn(),
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    sendToUser: jest.fn(),
    sendToUsers: jest.fn(),
    sendToTopic: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PushNotificationsController],
      providers: [
        {
          provide: PushNotificationsService,
          useValue: mockPushNotificationsService,
        },
      ],
    }).compile();

    controller = module.get<PushNotificationsController>(PushNotificationsController);
    pushNotificationsService = module.get<PushNotificationsService>(PushNotificationsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/push-notifications/status', () => {
    it('should return available status', () => {
      mockPushNotificationsService.isAvailable.mockReturnValue(true);

      const result = controller.getStatus();

      expect(pushNotificationsService.isAvailable).toHaveBeenCalled();
      expect(result.available).toBe(true);
    });

    it('should return unavailable status', () => {
      mockPushNotificationsService.isAvailable.mockReturnValue(false);

      const result = controller.getStatus();

      expect(result.available).toBe(false);
    });
  });

  describe('POST /api/v1/push-notifications/devices/register', () => {
    it('should register device for push notifications', async () => {
      const dto = {
        deviceToken: 'fcm-token-xyz123',
        platform: DevicePlatform.IOS,
        deviceName: 'iPhone 15 Pro',
      };

      const mockDevice = {
        id: 'device-123',
        userId: 'user-123',
        token: 'fcm-token-xyz123',
        platform: 'ios',
        deviceName: 'iPhone 15 Pro',
        createdAt: new Date().toISOString(),
      };

      mockPushNotificationsService.registerDevice.mockResolvedValue(mockDevice);

      const result = await controller.registerDevice(mockUser, dto);

      expect(pushNotificationsService.registerDevice).toHaveBeenCalledWith(
        'user-123',
        'tenant-123',
        dto,
      );
      expect(result.platform).toBe('ios');
    });

    it('should register Android device', async () => {
      const dto = {
        deviceToken: 'fcm-token-android',
        platform: DevicePlatform.ANDROID,
        deviceName: 'Samsung Galaxy S24',
      };

      const mockDevice = {
        id: 'device-456',
        platform: 'android',
        deviceName: 'Samsung Galaxy S24',
      };

      mockPushNotificationsService.registerDevice.mockResolvedValue(mockDevice);

      const result = await controller.registerDevice(mockUser, dto);

      expect(result.platform).toBe('android');
    });
  });

  describe('DELETE /api/v1/push-notifications/devices/:token', () => {
    it('should unregister device', async () => {
      const deviceToken = 'fcm-token-xyz123';

      mockPushNotificationsService.unregisterDevice.mockResolvedValue(undefined);

      const result = await controller.unregisterDevice(mockUser, deviceToken);

      expect(pushNotificationsService.unregisterDevice).toHaveBeenCalledWith(
        'user-123',
        deviceToken,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('GET /api/v1/push-notifications/devices', () => {
    it('should get registered devices', async () => {
      const mockDevices = [
        {
          id: 'device-1',
          token: 'token-1',
          platform: 'ios',
          deviceName: 'iPhone 15',
          createdAt: '2024-01-10T10:00:00Z',
        },
        {
          id: 'device-2',
          token: 'token-2',
          platform: 'android',
          deviceName: 'Pixel 8',
          createdAt: '2024-01-15T10:00:00Z',
        },
      ];

      mockPushNotificationsService.getUserDevices.mockResolvedValue(mockDevices);

      const result = await controller.getDevices(mockUser);

      expect(pushNotificationsService.getUserDevices).toHaveBeenCalledWith('user-123');
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no devices', async () => {
      mockPushNotificationsService.getUserDevices.mockResolvedValue([]);

      const result = await controller.getDevices(mockUser);

      expect(result).toHaveLength(0);
    });
  });

  describe('GET /api/v1/push-notifications/preferences', () => {
    it('should get notification preferences', async () => {
      const mockPreferences = {
        bookingNotifications: true,
        paymentNotifications: true,
        reminderNotifications: true,
        promotionalNotifications: false,
        systemNotifications: true,
      };

      mockPushNotificationsService.getPreferences.mockResolvedValue(mockPreferences);

      const result = await controller.getPreferences(mockUser);

      expect(pushNotificationsService.getPreferences).toHaveBeenCalledWith('user-123');
      expect(result.bookingNotifications).toBe(true);
      expect(result.promotionalNotifications).toBe(false);
    });
  });

  describe('POST /api/v1/push-notifications/preferences', () => {
    it('should update notification preferences', async () => {
      const dto = {
        bookingNotifications: true,
        paymentNotifications: true,
        reminderNotifications: false,
        promotionalNotifications: false,
        systemNotifications: true,
      };

      mockPushNotificationsService.updatePreferences.mockResolvedValue(undefined);

      const result = await controller.updatePreferences(mockUser, dto);

      expect(pushNotificationsService.updatePreferences).toHaveBeenCalledWith('user-123', dto);
      expect(result.success).toBe(true);
    });
  });

  describe('POST /api/v1/push-notifications/send', () => {
    it('should send push notification to a user', async () => {
      const dto = {
        userId: 'target-user-123',
        title: 'New Booking',
        body: 'You have a new booking for Room 101',
        data: { bookingId: 'b-123' },
      };

      const mockResult = {
        success: true,
        messageId: 'msg-123',
        sentTo: 2,
      };

      mockPushNotificationsService.sendToUser.mockResolvedValue(mockResult);

      const result = await controller.sendNotification(dto);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith(dto);
      expect(result.success).toBe(true);
    });
  });

  describe('POST /api/v1/push-notifications/send/bulk', () => {
    it('should send push notification to multiple users', async () => {
      const dto = {
        userIds: ['user-1', 'user-2', 'user-3'],
        title: 'System Update',
        body: 'New features available',
      };

      const mockResult = {
        successCount: 5,
        failureCount: 1,
      };

      mockPushNotificationsService.sendToUsers.mockResolvedValue(mockResult);

      const result = await controller.sendBulkNotification(dto);

      expect(pushNotificationsService.sendToUsers).toHaveBeenCalledWith(dto);
      expect(result.successCount).toBe(5);
    });
  });

  describe('POST /api/v1/push-notifications/send/topic', () => {
    it('should send push notification to a topic', async () => {
      const dto = {
        topic: 'hotel-staff-tenant-123',
        title: 'Urgent Notice',
        body: 'Staff meeting at 3pm',
      };

      const mockResult = {
        success: true,
        messageId: 'msg-456',
      };

      mockPushNotificationsService.sendToTopic.mockResolvedValue(mockResult);

      const result = await controller.sendTopicNotification(dto);

      expect(pushNotificationsService.sendToTopic).toHaveBeenCalledWith(dto);
      expect(result.success).toBe(true);
    });
  });

  describe('POST /api/v1/push-notifications/test', () => {
    it('should send test notification to current user', async () => {
      const mockResult = {
        success: true,
        messageId: 'test-msg-123',
      };

      mockPushNotificationsService.sendToUser.mockResolvedValue(mockResult);

      const result = await controller.sendTestNotification(mockUser);

      expect(pushNotificationsService.sendToUser).toHaveBeenCalledWith({
        userId: 'user-123',
        title: '🔔 Test Notification',
        body: 'Push notifications are working correctly!',
      });
      expect(result.success).toBe(true);
    });
  });
});
