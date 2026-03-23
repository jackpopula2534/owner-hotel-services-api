import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';
import {
  RegisterDeviceDto,
  SendPushNotificationDto,
  SendBulkPushNotificationDto,
  SendTopicNotificationDto,
  UpdatePushPreferencesDto,
  PushNotificationResponseDto,
  DeviceInfoDto,
  DevicePlatform,
  PushNotificationType,
} from './dto/push-notification.dto';

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  /**
   * Initialize Firebase Admin SDK
   */
  private async initializeFirebase(): Promise<void> {
    try {
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
      const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

      if (!projectId || !clientEmail || !privateKey) {
        this.logger.warn('Firebase credentials not configured, push notifications disabled');
        return;
      }

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      });

      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase: ${error.message}`);
    }
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }

  /**
   * Register device for push notifications
   */
  async registerDevice(
    userId: string,
    tenantId: string,
    dto: RegisterDeviceDto,
  ): Promise<DeviceInfoDto> {
    // Upsert device token
    const device = await this.prisma.pushNotificationDevice.upsert({
      where: {
        userId_deviceToken: {
          userId,
          deviceToken: dto.deviceToken,
        },
      },
      create: {
        userId,
        tenantId,
        deviceToken: dto.deviceToken,
        platform: dto.platform,
        deviceModel: dto.deviceModel,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        isActive: true,
        lastActiveAt: new Date(),
      },
      update: {
        platform: dto.platform,
        deviceModel: dto.deviceModel,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        isActive: true,
        lastActiveAt: new Date(),
      },
    });

    // Subscribe to tenant topic for broadcast messages
    if (this.isInitialized) {
      try {
        await admin.messaging().subscribeToTopic(dto.deviceToken, `tenant_${tenantId}`);
      } catch (error) {
        this.logger.warn(`Failed to subscribe to topic: ${error.message}`);
      }
    }

    this.logger.log(`Device registered for user ${userId}`);

    return {
      id: device.id,
      platform: device.platform as DevicePlatform,
      deviceModel: device.deviceModel || undefined,
      appVersion: device.appVersion || undefined,
      isActive: device.isActive,
      lastActiveAt: device.lastActiveAt,
    };
  }

  /**
   * Unregister device
   */
  async unregisterDevice(userId: string, deviceToken: string): Promise<void> {
    await this.prisma.pushNotificationDevice.updateMany({
      where: { userId, deviceToken },
      data: { isActive: false },
    });

    this.logger.log(`Device unregistered for user ${userId}`);
  }

  /**
   * Send push notification to a user
   */
  async sendToUser(
    dto: SendPushNotificationDto,
  ): Promise<PushNotificationResponseDto> {
    if (!this.isInitialized) {
      return { success: false, error: 'Push notifications not configured' };
    }

    // Get user's active devices
    const devices = await this.prisma.pushNotificationDevice.findMany({
      where: {
        userId: dto.userId,
        isActive: true,
      },
    });

    if (devices.length === 0) {
      return { success: false, error: 'No active devices found' };
    }

    const tokens = devices.map((d) => d.deviceToken);
    const message = this.buildMessage(dto);

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: message.notification,
        data: message.data,
        android: message.android,
        apns: message.apns,
      });

      // Log notification
      await this.logNotification(dto.userId, dto.title, dto.body, dto.type);

      // Handle failed tokens
      if (response.failureCount > 0) {
        await this.handleFailedTokens(tokens, response.responses);
      }

      this.logger.log(`Push notification sent to user ${dto.userId}`);

      return {
        success: response.successCount > 0,
        messageId: response.responses[0]?.messageId,
      };
    } catch (error) {
      this.logger.error(`Failed to send push notification: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send push notification to multiple users
   */
  async sendToUsers(
    dto: SendBulkPushNotificationDto,
  ): Promise<{ successCount: number; failureCount: number }> {
    if (!this.isInitialized) {
      return { successCount: 0, failureCount: dto.userIds.length };
    }

    let successCount = 0;
    let failureCount = 0;

    for (const userId of dto.userIds) {
      const result = await this.sendToUser({
        userId,
        title: dto.title,
        body: dto.body,
        type: dto.type,
        data: dto.data,
      });

      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }

    return { successCount, failureCount };
  }

  /**
   * Send push notification to a topic (all subscribers)
   */
  async sendToTopic(
    dto: SendTopicNotificationDto,
  ): Promise<PushNotificationResponseDto> {
    if (!this.isInitialized) {
      return { success: false, error: 'Push notifications not configured' };
    }

    try {
      const message: admin.messaging.Message = {
        topic: dto.topic,
        notification: {
          title: dto.title,
          body: dto.body,
        },
        data: {
          type: dto.type || PushNotificationType.SYSTEM,
          ...dto.data,
        },
      };

      const response = await admin.messaging().send(message);

      this.logger.log(`Push notification sent to topic ${dto.topic}`);

      return { success: true, messageId: response };
    } catch (error) {
      this.logger.error(`Failed to send topic notification: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to all users in a tenant
   */
  async sendToTenant(
    tenantId: string,
    title: string,
    body: string,
    type?: PushNotificationType,
    data?: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }> {
    return this.sendToTopic({
      topic: `tenant_${tenantId}`,
      title,
      body,
      type,
      data,
    }).then((result) => ({
      successCount: result.success ? 1 : 0,
      failureCount: result.success ? 0 : 1,
    }));
  }

  /**
   * Get user's registered devices
   */
  async getUserDevices(userId: string): Promise<DeviceInfoDto[]> {
    const devices = await this.prisma.pushNotificationDevice.findMany({
      where: { userId, isActive: true },
    });

    return devices.map((d) => ({
      id: d.id,
      platform: d.platform as DevicePlatform,
      deviceModel: d.deviceModel || undefined,
      appVersion: d.appVersion || undefined,
      isActive: d.isActive,
      lastActiveAt: d.lastActiveAt,
    }));
  }

  /**
   * Update push notification preferences
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePushPreferencesDto,
  ): Promise<void> {
    await this.prisma.pushNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        bookingNotifications: dto.bookingNotifications ?? true,
        paymentNotifications: dto.paymentNotifications ?? true,
        reminderNotifications: dto.reminderNotifications ?? true,
        promotionalNotifications: dto.promotionalNotifications ?? false,
        systemNotifications: dto.systemNotifications ?? true,
      },
      update: dto,
    });
  }

  /**
   * Get push notification preferences
   */
  async getPreferences(userId: string) {
    const prefs = await this.prisma.pushNotificationPreference.findUnique({
      where: { userId },
    });

    return (
      prefs || {
        bookingNotifications: true,
        paymentNotifications: true,
        reminderNotifications: true,
        promotionalNotifications: false,
        systemNotifications: true,
      }
    );
  }

  /**
   * Check if user has enabled specific notification type
   */
  async isNotificationTypeEnabled(
    userId: string,
    type: PushNotificationType,
  ): Promise<boolean> {
    const prefs = await this.getPreferences(userId);

    switch (type) {
      case PushNotificationType.BOOKING:
        return prefs.bookingNotifications;
      case PushNotificationType.PAYMENT:
        return prefs.paymentNotifications;
      case PushNotificationType.REMINDER:
        return prefs.reminderNotifications;
      case PushNotificationType.PROMOTION:
        return prefs.promotionalNotifications;
      case PushNotificationType.SYSTEM:
      case PushNotificationType.ALERT:
        return prefs.systemNotifications;
      default:
        return true;
    }
  }

  /**
   * Build FCM message
   */
  private buildMessage(dto: SendPushNotificationDto): {
    notification: admin.messaging.Notification;
    data: Record<string, string>;
    android: admin.messaging.AndroidConfig;
    apns: admin.messaging.ApnsConfig;
  } {
    return {
      notification: {
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl,
      },
      data: {
        type: dto.type || PushNotificationType.SYSTEM,
        actionUrl: dto.actionUrl || '',
        ...dto.data,
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };
  }

  /**
   * Log notification for history
   */
  private async logNotification(
    userId: string,
    title: string,
    body: string,
    type?: PushNotificationType,
  ): Promise<void> {
    try {
      await this.prisma.pushNotificationLog.create({
        data: {
          userId,
          title,
          body,
          type: type || PushNotificationType.SYSTEM,
          sentAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to log notification: ${error.message}`);
    }
  }

  /**
   * Handle failed tokens (mark as inactive)
   */
  private async handleFailedTokens(
    tokens: string[],
    responses: admin.messaging.SendResponse[],
  ): Promise<void> {
    const failedTokens: string[] = [];

    responses.forEach((response, index) => {
      if (!response.success) {
        const error = response.error;
        if (
          error?.code === 'messaging/invalid-registration-token' ||
          error?.code === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[index]);
        }
      }
    });

    if (failedTokens.length > 0) {
      await this.prisma.pushNotificationDevice.updateMany({
        where: { deviceToken: { in: failedTokens } },
        data: { isActive: false },
      });

      this.logger.log(`Deactivated ${failedTokens.length} invalid tokens`);
    }
  }
}
