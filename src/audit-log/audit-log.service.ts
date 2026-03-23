import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAuditLogDto,
  AuditLogQueryDto,
  AuditAction,
  AuditResource,
} from './dto/audit-log.dto';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an audit log entry
   */
  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: dto.action,
          resource: dto.resource,
          resourceId: dto.resourceId,
          oldValues: dto.oldValues ? JSON.parse(JSON.stringify(dto.oldValues)) : null,
          newValues: dto.newValues ? JSON.parse(JSON.stringify(dto.newValues)) : null,
          description: dto.description,
          tenantId: dto.tenantId,
          userId: dto.userId,
          adminId: dto.adminId,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
        },
      });
    } catch (error) {
      // Log error but don't throw - audit logging should not break main functionality
      this.logger.error(`Failed to create audit log: ${error.message}`);
    }
  }

  /**
   * Log user login
   */
  async logLogin(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    tenantId?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN,
      resource: AuditResource.USER,
      resourceId: userId,
      userId,
      tenantId,
      ipAddress,
      userAgent,
      description: 'User logged in',
    });
  }

  /**
   * Log admin login
   */
  async logAdminLogin(
    adminId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN,
      resource: AuditResource.ADMIN,
      resourceId: adminId,
      adminId,
      ipAddress,
      userAgent,
      description: 'Admin logged in',
    });
  }

  /**
   * Log failed login attempt
   */
  async logLoginFailed(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN_FAILED,
      resource: AuditResource.USER,
      ipAddress,
      userAgent,
      description: `Failed login attempt for ${email}`,
    });
  }

  /**
   * Log logout
   */
  async logLogout(
    userId: string,
    isAdmin: boolean = false,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.LOGOUT,
      resource: isAdmin ? AuditResource.ADMIN : AuditResource.USER,
      resourceId: userId,
      userId: isAdmin ? undefined : userId,
      adminId: isAdmin ? userId : undefined,
      ipAddress,
      description: `${isAdmin ? 'Admin' : 'User'} logged out`,
    });
  }

  /**
   * Log booking creation
   */
  async logBookingCreate(
    booking: any,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.BOOKING_CREATE,
      resource: AuditResource.BOOKING,
      resourceId: booking.id,
      newValues: {
        guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        roomId: booking.roomId,
        totalPrice: booking.totalPrice,
      },
      userId,
      tenantId: booking.tenantId,
      ipAddress,
      description: `Booking created for ${booking.guestFirstName} ${booking.guestLastName}`,
    });
  }

  /**
   * Log booking cancellation
   */
  async logBookingCancel(
    booking: any,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.BOOKING_CANCEL,
      resource: AuditResource.BOOKING,
      resourceId: booking.id,
      oldValues: { status: booking.status },
      newValues: { status: 'cancelled' },
      userId,
      tenantId: booking.tenantId,
      ipAddress,
      description: `Booking cancelled for ${booking.guestFirstName} ${booking.guestLastName}`,
    });
  }

  /**
   * Log payment approval
   */
  async logPaymentApprove(
    payment: any,
    adminId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.PAYMENT_APPROVE,
      resource: AuditResource.PAYMENT,
      resourceId: payment.id,
      oldValues: { status: 'pending' },
      newValues: { status: 'approved', approvedBy: adminId },
      adminId,
      ipAddress,
      description: `Payment ${payment.payment_no} approved`,
    });
  }

  /**
   * Log room status change
   */
  async logRoomStatusChange(
    room: any,
    oldStatus: string,
    newStatus: string,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.ROOM_STATUS_CHANGE,
      resource: AuditResource.ROOM,
      resourceId: room.id,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      userId,
      tenantId: room.tenantId,
      ipAddress,
      description: `Room ${room.number} status changed from ${oldStatus} to ${newStatus}`,
    });
  }

  /**
   * Log guest data access
   */
  async logGuestDataAccess(
    guestId: string,
    userId: string,
    tenantId?: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.GUEST_DATA_ACCESS,
      resource: AuditResource.GUEST,
      resourceId: guestId,
      userId,
      tenantId,
      ipAddress,
      description: `Guest data accessed`,
    });
  }

  /**
   * Log settings change
   */
  async logSettingsChange(
    oldSettings: any,
    newSettings: any,
    userId: string,
    tenantId?: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.SETTINGS_UPDATE,
      resource: AuditResource.SETTINGS,
      oldValues: oldSettings,
      newValues: newSettings,
      userId,
      tenantId,
      ipAddress,
      description: 'Settings updated',
    });
  }

  /**
   * Log role change
   */
  async logRoleChange(
    targetUserId: string,
    oldRole: string,
    newRole: string,
    changedBy: string,
    tenantId?: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.ROLE_CHANGE,
      resource: AuditResource.USER,
      resourceId: targetUserId,
      oldValues: { role: oldRole },
      newValues: { role: newRole },
      userId: changedBy,
      tenantId,
      ipAddress,
      description: `User role changed from ${oldRole} to ${newRole}`,
    });
  }

  /**
   * Log 2FA enable
   */
  async log2FAEnabled(
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.TWO_FA_ENABLED,
      resource: AuditResource.USER,
      resourceId: userId,
      userId,
      ipAddress,
      description: 'Two-factor authentication enabled',
    });
  }

  /**
   * Log 2FA disable
   */
  async log2FADisabled(
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.log({
      action: AuditAction.TWO_FA_DISABLED,
      resource: AuditResource.USER,
      resourceId: userId,
      userId,
      ipAddress,
      description: 'Two-factor authentication disabled',
    });
  }

  /**
   * Get audit logs with filtering and pagination
   */
  async getLogs(query: AuditLogQueryDto, tenantId?: string) {
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.adminId) {
      where.adminId = query.adminId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.resource) {
      where.resource = query.resource;
    }

    if (query.resourceId) {
      where.resourceId = query.resourceId;
    }

    if (query.search) {
      where.description = { contains: query.search };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get audit log by ID
   */
  async getLogById(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId) {
      where.tenantId = tenantId;
    }

    return this.prisma.auditLog.findFirst({ where });
  }

  /**
   * Export audit logs to CSV format
   */
  async exportLogs(query: AuditLogQueryDto, tenantId?: string): Promise<string> {
    // Get all matching logs (no pagination for export)
    const where: any = {};

    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (query.action) {
      where.action = query.action;
    }

    if (query.resource) {
      where.resource = query.resource;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000, // Limit export to 10k records
    });

    // Convert to CSV
    const headers = ['ID', 'Timestamp', 'Action', 'Resource', 'Resource ID', 'User ID', 'Admin ID', 'IP Address', 'Description'];
    const rows = logs.map((log) => [
      log.id,
      log.createdAt.toISOString(),
      log.action,
      log.resource,
      log.resourceId || '',
      log.userId || '',
      log.adminId || '',
      log.ipAddress || '',
      log.description || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Clean up old audit logs (retention policy)
   */
  async cleanupOldLogs(retentionDays: number = 180): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(`Deleted ${result.count} audit logs older than ${retentionDays} days`);
    return result.count;
  }
}
