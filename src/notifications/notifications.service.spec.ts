import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotFoundException } from '@nestjs/common';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: PrismaService;
  let gateway: NotificationsGateway;

  const mockNotification = {
    id: '1',
    userId: 'user-1',
    type: 'booking',
    title: 'New Booking',
    message: 'You have a new booking',
    isRead: false,
    createdAt: new Date(),
  };

  const mockPrismaService = {
    notification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockGateway = {
    sendToUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationsGateway,
          useValue: mockGateway,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
    gateway = module.get<NotificationsGateway>(NotificationsGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated notifications', async () => {
      const query = { page: '1', limit: '10' };
      mockPrismaService.notification.findMany.mockResolvedValue([mockNotification]);
      mockPrismaService.notification.count.mockResolvedValue(1);

      const result = await service.findAll('user-1', query);

      expect(result).toEqual({
        items: [mockNotification],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      });
      expect(prisma.notification.findMany).toHaveBeenCalled();
      expect(prisma.notification.count).toHaveBeenCalled();
    });

    it('should filter by isRead status', async () => {
      const query = { page: '1', limit: '10', isRead: 'true' };
      mockPrismaService.notification.findMany.mockResolvedValue([]);
      mockPrismaService.notification.count.mockResolvedValue(0);

      await service.findAll('user-1', query);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isRead: true,
          }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should create notification and send via gateway', async () => {
      mockPrismaService.notification.create.mockResolvedValue(mockNotification);

      const result = await service.create({
        userId: 'user-1',
        type: 'booking',
        title: 'New Booking',
        message: 'You have a new booking',
      });

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.create).toHaveBeenCalled();
      expect(gateway.sendToUser).toHaveBeenCalledWith('user-1', 'notification', mockNotification);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(mockNotification);
      mockPrismaService.notification.update.mockResolvedValue({
        ...mockNotification,
        isRead: true,
      });

      const result = await service.markAsRead('1', 'user-1');

      expect(result.isRead).toBe(true);
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { isRead: true },
      });
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead('999', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all user notifications as read', async () => {
      mockPrismaService.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead('user-1');

      expect(result.count).toBe(5);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
    });
  });

  describe('remove', () => {
    it('should delete notification', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(mockNotification);
      mockPrismaService.notification.delete.mockResolvedValue(mockNotification);

      const result = await service.remove('1', 'user-1');

      expect(result).toEqual(mockNotification);
      expect(prisma.notification.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });

    it('should throw NotFoundException if notification not found', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(null);

      await expect(service.remove('999', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
