import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto, NotificationQueryDto } from './dto/notification.dto';
import { NotificationsGateway } from './notifications.gateway';
import { Prisma } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  async findAll(userId: string, query: NotificationQueryDto) {
    if (!userId) {
      return {
        items: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      };
    }

    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, parseInt(query.limit || '10') || 10);
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (query.isRead !== undefined) {
      where.isRead = query.isRead === 'true';
    }

    try {
      const [items, total] = await Promise.all([
        this.prisma.notification.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.notification.count({ where }),
      ]);

      return {
        items,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      // ถ้าเกิด database error (table ไม่มี) ให้ส่ง empty data สำหรับผู้ใช้ใหม่
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return {
            items: [],
            meta: { total: 0, page, limit, totalPages: 0 },
          };
        }
      }
      throw error;
    }
  }

  async create(data: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data,
    });

    if (notification.userId) {
      this.gateway.sendToUser(notification.userId, 'notification', notification);
    }

    return notification;
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async remove(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification with ID ${id} not found`);
    }

    return this.prisma.notification.delete({
      where: { id },
    });
  }
}
