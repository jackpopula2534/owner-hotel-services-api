import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification.dto';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: NotificationsService;

  const mockNotification = {
    id: '1',
    userId: 'user-1',
    type: 'booking',
    title: 'New Booking',
    message: 'You have a new booking',
    isRead: false,
    createdAt: new Date(),
  };

  const mockNotificationsService = {
    findAll: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated notifications', async () => {
      const mockUser = { id: 'user-1', tenantId: 'tenant-1' };
      const query: NotificationQueryDto = { page: '1', limit: '10' };
      const mockResult = {
        items: [mockNotification],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      mockNotificationsService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(mockUser, query);

      expect(service.findAll).toHaveBeenCalledWith('user-1', query);
      expect(result).toEqual(mockResult);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const mockUser = { id: 'user-1' };
      const updatedNotification = { ...mockNotification, isRead: true };

      mockNotificationsService.markAsRead.mockResolvedValue(updatedNotification);

      const result = await controller.markAsRead('1', mockUser);

      expect(service.markAsRead).toHaveBeenCalledWith('1', 'user-1');
      expect(result.isRead).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', async () => {
      const mockUser = { id: 'user-1' };
      const mockResult = { count: 5 };

      mockNotificationsService.markAllAsRead.mockResolvedValue(mockResult);

      const result = await controller.markAllAsRead(mockUser);

      expect(service.markAllAsRead).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('remove', () => {
    it('should delete notification', async () => {
      const mockUser = { id: 'user-1' };

      mockNotificationsService.remove.mockResolvedValue(mockNotification);

      const result = await controller.remove('1', mockUser);

      expect(service.remove).toHaveBeenCalledWith('1', 'user-1');
      expect(result).toEqual(mockNotification);
    });
  });
});
