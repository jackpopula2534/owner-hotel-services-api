import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAuditLogDto,
  AuditLogQueryDto,
  AuditAction,
  AuditResource,
  AuditCategory,
} from './dto/audit-log.dto';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // Core logging method
  // ============================================================

  async log(dto: CreateAuditLogDto): Promise<void> {
    try {
      // Note: category field added via migration — use type assertion until prisma generate runs
      await this.prisma.auditLog.create({
        data: {
          action: dto.action,
          resource: dto.resource,
          resourceId: dto.resourceId,
          category: dto.category || AuditCategory.GENERAL,
          oldValues: dto.oldValues ? JSON.parse(JSON.stringify(dto.oldValues)) : null,
          newValues: dto.newValues ? JSON.parse(JSON.stringify(dto.newValues)) : null,
          description: dto.description,
          tenantId: dto.tenantId,
          userId: dto.userId,
          adminId: dto.adminId,
          ipAddress: dto.ipAddress,
          userAgent: dto.userAgent,
        } as any,
      });
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`);
    }
  }

  // ============================================================
  // Auth logs (category: auth)
  // ============================================================

  async logLogin(userId: string, ipAddress?: string, userAgent?: string, tenantId?: string): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN, resource: AuditResource.USER,
      category: AuditCategory.AUTH,
      resourceId: userId, userId, tenantId, ipAddress, userAgent,
      description: 'เข้าสู่ระบบ',
    });
  }

  async logAdminLogin(adminId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN, resource: AuditResource.ADMIN,
      category: AuditCategory.AUTH,
      resourceId: adminId, adminId, ipAddress, userAgent,
      description: 'ผู้ดูแลระบบเข้าสู่ระบบ',
    });
  }

  async logLoginFailed(email: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await this.log({
      action: AuditAction.LOGIN_FAILED, resource: AuditResource.USER,
      category: AuditCategory.AUTH,
      ipAddress, userAgent,
      description: `เข้าสู่ระบบล้มเหลว: ${email}`,
    });
  }

  async logLogout(userId: string, isAdmin: boolean = false, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.LOGOUT,
      resource: isAdmin ? AuditResource.ADMIN : AuditResource.USER,
      category: AuditCategory.AUTH,
      resourceId: userId,
      userId: isAdmin ? undefined : userId,
      adminId: isAdmin ? userId : undefined,
      ipAddress,
      description: `${isAdmin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้'}ออกจากระบบ`,
    });
  }

  async log2FAEnabled(userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.TWO_FA_ENABLED, resource: AuditResource.USER,
      category: AuditCategory.AUTH,
      resourceId: userId, userId, ipAddress,
      description: 'เปิดใช้งานยืนยันตัวตน 2 ขั้นตอน',
    });
  }

  async log2FADisabled(userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.TWO_FA_DISABLED, resource: AuditResource.USER,
      category: AuditCategory.AUTH,
      resourceId: userId, userId, ipAddress,
      description: 'ปิดใช้งานยืนยันตัวตน 2 ขั้นตอน',
    });
  }

  // ============================================================
  // Room logs (category: rooms)
  // ============================================================

  async logRoomCreate(room: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ROOM_CREATE, resource: AuditResource.ROOM,
      category: AuditCategory.ROOMS,
      resourceId: room.id, userId, tenantId: tenantId || room.tenantId, ipAddress,
      newValues: { number: room.number, type: room.type, status: room.status, price: room.price },
      description: `สร้างห้องพัก ${room.number || room.id}`,
    });
  }

  async logRoomUpdate(roomId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ROOM_UPDATE, resource: AuditResource.ROOM,
      category: AuditCategory.ROOMS,
      resourceId: roomId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขห้องพัก ${oldData?.number || roomId}`,
    });
  }

  async logRoomDelete(room: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ROOM_DELETE, resource: AuditResource.ROOM,
      category: AuditCategory.ROOMS,
      resourceId: room.id, userId, tenantId: tenantId || room.tenantId, ipAddress,
      oldValues: { number: room.number, type: room.type },
      description: `ลบห้องพัก ${room.number || room.id}`,
    });
  }

  async logRoomStatusChange(room: any, oldStatus: string, newStatus: string, userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ROOM_STATUS_CHANGE, resource: AuditResource.ROOM,
      category: AuditCategory.ROOMS,
      resourceId: room.id, userId, tenantId: room.tenantId, ipAddress,
      oldValues: { status: oldStatus }, newValues: { status: newStatus },
      description: `เปลี่ยนสถานะห้อง ${room.number} จาก ${oldStatus} เป็น ${newStatus}`,
    });
  }

  // ============================================================
  // Guest logs (category: guests)
  // ============================================================

  async logGuestCreate(guest: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.GUEST_CREATE, resource: AuditResource.GUEST,
      category: AuditCategory.GUESTS,
      resourceId: guest.id, userId, tenantId: tenantId || guest.tenantId, ipAddress,
      newValues: { firstName: guest.firstName, lastName: guest.lastName, email: guest.email },
      description: `สร้างข้อมูลผู้เข้าพัก ${guest.firstName || ''} ${guest.lastName || ''}`,
    });
  }

  async logGuestUpdate(guestId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.GUEST_UPDATE, resource: AuditResource.GUEST,
      category: AuditCategory.GUESTS,
      resourceId: guestId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขข้อมูลผู้เข้าพัก ${oldData?.firstName || ''} ${oldData?.lastName || guestId}`,
    });
  }

  async logGuestDataAccess(guestId: string, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.GUEST_DATA_ACCESS, resource: AuditResource.GUEST,
      category: AuditCategory.GUESTS,
      resourceId: guestId, userId, tenantId, ipAddress,
      description: 'เข้าถึงข้อมูลผู้เข้าพัก',
    });
  }

  // ============================================================
  // Booking logs (category: bookings)
  // ============================================================

  async logBookingCreate(booking: any, userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.BOOKING_CREATE, resource: AuditResource.BOOKING,
      category: AuditCategory.BOOKINGS,
      resourceId: booking.id, userId, tenantId: booking.tenantId, ipAddress,
      newValues: {
        guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
        checkIn: booking.checkIn, checkOut: booking.checkOut,
        roomId: booking.roomId, totalPrice: booking.totalPrice,
      },
      description: `สร้างการจองใหม่สำหรับคุณ${booking.guestFirstName || ''} ${booking.guestLastName || ''}`,
    });
  }

  async logBookingCancel(booking: any, userId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.BOOKING_CANCEL, resource: AuditResource.BOOKING,
      category: AuditCategory.BOOKINGS,
      resourceId: booking.id, userId, tenantId: booking.tenantId, ipAddress,
      oldValues: { status: booking.status }, newValues: { status: 'cancelled' },
      description: `ยกเลิกการจองสำหรับคุณ${booking.guestFirstName || ''} ${booking.guestLastName || ''}`,
    });
  }

  // ============================================================
  // Restaurant/Order logs (category: restaurant)
  // ============================================================

  async logOrderCreate(order: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ORDER_CREATE, resource: AuditResource.ORDER,
      category: AuditCategory.RESTAURANT,
      resourceId: order.id, userId, tenantId: tenantId || order.tenantId, ipAddress,
      newValues: { orderNo: order.orderNo, tableId: order.tableId, total: order.total, itemCount: order.items?.length },
      description: `สร้างออเดอร์ ${order.orderNo || order.id}`,
    });
  }

  async logOrderUpdate(orderId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ORDER_UPDATE, resource: AuditResource.ORDER,
      category: AuditCategory.RESTAURANT,
      resourceId: orderId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขออเดอร์ ${oldData?.orderNo || orderId}`,
    });
  }

  async logOrderCancel(order: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ORDER_CANCEL, resource: AuditResource.ORDER,
      category: AuditCategory.RESTAURANT,
      resourceId: order.id, userId, tenantId: tenantId || order.tenantId, ipAddress,
      oldValues: { status: order.status }, newValues: { status: 'cancelled' },
      description: `ยกเลิกออเดอร์ ${order.orderNo || order.id}`,
    });
  }

  async logMenuUpdate(menuItem: any, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.MENU_UPDATE, resource: AuditResource.MENU,
      category: AuditCategory.RESTAURANT,
      resourceId: menuItem.id, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขเมนู ${menuItem.name || menuItem.id}`,
    });
  }

  // ============================================================
  // Housekeeping logs (category: housekeeping)
  // ============================================================

  async logHousekeepingTaskCompletion(task: any, completedByUserId?: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.HOUSEKEEPING_TASK_COMPLETE, resource: AuditResource.HOUSEKEEPING_TASK,
      category: AuditCategory.HOUSEKEEPING,
      resourceId: task.id, userId: completedByUserId, tenantId: tenantId ?? task.tenantId, ipAddress,
      oldValues: { status: task.previousStatus ?? task.status, roomStatus: task.previousRoomStatus ?? 'cleaning' },
      newValues: { status: 'completed', roomId: task.roomId, roomNumber: task.room?.number },
      description: `แม่บ้านเสร็จสิ้นงาน ห้อง ${task.room?.number ?? task.roomId ?? 'N/A'}`,
    });
  }

  // ============================================================
  // Maintenance logs (category: maintenance)
  // ============================================================

  async logMaintenanceCreate(task: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.MAINTENANCE_CREATE, resource: AuditResource.MAINTENANCE_TASK,
      category: AuditCategory.MAINTENANCE,
      resourceId: task.id, userId, tenantId: tenantId || task.tenantId, ipAddress,
      newValues: { roomId: task.roomId, type: task.type, priority: task.priority },
      description: `สร้างงานซ่อมบำรุง ${task.id}`,
    });
  }

  async logMaintenanceUpdate(taskId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.MAINTENANCE_UPDATE, resource: AuditResource.MAINTENANCE_TASK,
      category: AuditCategory.MAINTENANCE,
      resourceId: taskId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `อัพเดทงานซ่อมบำรุง ${taskId}`,
    });
  }

  async logMaintenanceComplete(task: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.MAINTENANCE_COMPLETE, resource: AuditResource.MAINTENANCE_TASK,
      category: AuditCategory.MAINTENANCE,
      resourceId: task.id, userId, tenantId: tenantId || task.tenantId, ipAddress,
      oldValues: { status: task.status }, newValues: { status: 'completed' },
      description: `งานซ่อมบำรุงเสร็จสิ้น ${task.id}`,
    });
  }

  // ============================================================
  // Payment logs (category: payments)
  // ============================================================

  async logPaymentApprove(payment: any, adminId: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.PAYMENT_APPROVE, resource: AuditResource.PAYMENT,
      category: AuditCategory.PAYMENTS,
      resourceId: payment.id, adminId, ipAddress,
      oldValues: { status: 'pending' }, newValues: { status: 'approved', approvedBy: adminId },
      description: `อนุมัติการชำระเงิน ${payment.payment_no}`,
    });
  }

  // ============================================================
  // User logs (category: users)
  // ============================================================

  async logUserCreate(user: any, createdBy: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.USER_CREATE, resource: AuditResource.USER,
      category: AuditCategory.USERS,
      resourceId: user.id, userId: createdBy, tenantId, ipAddress,
      newValues: { email: user.email, role: user.role },
      description: `สร้างผู้ใช้ ${user.email || user.id}`,
    });
  }

  async logUserUpdate(userId: string, oldData: any, newData: any, updatedBy: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.USER_UPDATE, resource: AuditResource.USER,
      category: AuditCategory.USERS,
      resourceId: userId, userId: updatedBy, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขข้อมูลผู้ใช้ ${oldData?.email || userId}`,
    });
  }

  async logRoleChange(targetUserId: string, oldRole: string, newRole: string, changedBy: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.ROLE_CHANGE, resource: AuditResource.USER,
      category: AuditCategory.USERS,
      resourceId: targetUserId, userId: changedBy, tenantId, ipAddress,
      oldValues: { role: oldRole }, newValues: { role: newRole },
      description: `เปลี่ยนบทบาทผู้ใช้จาก ${oldRole} เป็น ${newRole}`,
    });
  }

  // ============================================================
  // Property logs (category: properties)
  // ============================================================

  async logPropertyUpdate(propertyId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.PROPERTY_UPDATE, resource: AuditResource.PROPERTY,
      category: AuditCategory.PROPERTIES,
      resourceId: propertyId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขข้อมูลโรงแรม ${oldData?.name || propertyId}`,
    });
  }

  // ============================================================
  // Staff logs (category: staff)
  // ============================================================

  async logStaffCreate(staff: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.STAFF_CREATE, resource: AuditResource.STAFF,
      category: AuditCategory.STAFF,
      resourceId: staff.id, userId, tenantId, ipAddress,
      newValues: { name: staff.name, role: staff.role, department: staff.department },
      description: `เพิ่มพนักงาน ${staff.name || staff.id}`,
    });
  }

  async logStaffUpdate(staffId: string, oldData: any, newData: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.STAFF_UPDATE, resource: AuditResource.STAFF,
      category: AuditCategory.STAFF,
      resourceId: staffId, userId, tenantId, ipAddress,
      oldValues: oldData, newValues: newData,
      description: `แก้ไขข้อมูลพนักงาน ${oldData?.name || staffId}`,
    });
  }

  // ============================================================
  // Settings logs (category: settings)
  // ============================================================

  async logSettingsChange(oldSettings: any, newSettings: any, userId: string, tenantId?: string, ipAddress?: string): Promise<void> {
    await this.log({
      action: AuditAction.SETTINGS_UPDATE, resource: AuditResource.SETTINGS,
      category: AuditCategory.SETTINGS,
      oldValues: oldSettings, newValues: newSettings, userId, tenantId, ipAddress,
      description: 'อัพเดทการตั้งค่า',
    });
  }

  // ============================================================
  // Query methods
  // ============================================================

  private buildWhereClause(query: AuditLogQueryDto, tenantId?: string): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (tenantId) { where.tenantId = tenantId; }
    if (query.userId) { where.userId = query.userId; }
    if (query.adminId) { where.adminId = query.adminId; }
    if (query.action) { where.action = query.action; }
    if (query.resource) { where.resource = query.resource; }
    if (query.resourceId) { where.resourceId = query.resourceId; }
    if (query.category) { where.category = query.category; }
    if (query.search) { where.description = { contains: query.search }; }

    if (query.startDate || query.endDate) {
      const createdAt: Record<string, Date> = {};
      if (query.startDate) { createdAt.gte = new Date(query.startDate); }
      if (query.endDate) { createdAt.lte = new Date(query.endDate); }
      where.createdAt = createdAt;
    }

    return where;
  }

  /**
   * Batch-resolve user and admin names from their IDs
   */
  private async resolveUserNames(
    userIds: string[],
    adminIds: string[],
  ): Promise<{ userMap: Map<string, { name: string; email: string; role: string }>; adminMap: Map<string, { name: string; email: string; role: string }> }> {
    const userMap = new Map<string, { name: string; email: string; role: string }>();
    const adminMap = new Map<string, { name: string; email: string; role: string }>();

    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    const uniqueAdminIds = [...new Set(adminIds.filter(Boolean))];

    try {
      if (uniqueUserIds.length > 0) {
        const users = await this.prisma.user.findMany({
          where: { id: { in: uniqueUserIds } },
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        });
        for (const u of users) {
          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
          userMap.set(u.id, { name, email: u.email, role: u.role });
        }
      }

      if (uniqueAdminIds.length > 0) {
        const admins = await this.prisma.admin.findMany({
          where: { id: { in: uniqueAdminIds } },
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        });
        for (const a of admins) {
          const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || a.email;
          adminMap.set(a.id, { name, email: a.email, role: a.role });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to resolve user names: ${error.message}`);
    }

    return { userMap, adminMap };
  }

  private transformLogEntry(
    log: Record<string, any>,
    userInfo?: { name: string; email: string; role: string },
  ): Record<string, unknown> {
    const actorId = log.userId || log.adminId || '';
    const actorName = userInfo?.name || actorId || 'System';
    const actorEmail = userInfo?.email || '';
    const actorRole = userInfo?.role || (log.adminId ? 'admin' : 'user');

    return {
      id: log.id,
      action: log.action,
      resourceType: log.resource,
      resourceId: log.resourceId || undefined,
      category: log.category || 'general',
      userId: actorId,
      userName: actorName,
      userEmail: actorEmail,
      userRole: actorRole,
      ipAddress: log.ipAddress || '',
      userAgent: log.userAgent || '',
      details: log.description ? { description: log.description } : undefined,
      oldValues: log.oldValues || undefined,
      newValues: log.newValues || undefined,
      status: log.action === 'login_failed' ? 'failure' : 'success',
      errorMessage: log.action === 'login_failed' ? log.description : undefined,
      description: log.description || '',
      createdAt: log.createdAt,
    };
  }

  async getLogs(query: AuditLogQueryDto, tenantId?: string) {
    const where = this.buildWhereClause(query, tenantId);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [rawData, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Batch-resolve user/admin names for all logs in this page
    const userIds = rawData.map((l) => l.userId).filter(Boolean) as string[];
    const adminIds = rawData.map((l) => l.adminId).filter(Boolean) as string[];
    const { userMap, adminMap } = await this.resolveUserNames(userIds, adminIds);

    const data = rawData.map((log) => {
      const info = log.userId ? userMap.get(log.userId) : log.adminId ? adminMap.get(log.adminId) : undefined;
      return this.transformLogEntry(log, info);
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getStats(params: { startDate?: string; endDate?: string }, tenantId?: string) {
    const where: Record<string, unknown> = {};
    if (tenantId) { where.tenantId = tenantId; }
    if (params.startDate || params.endDate) {
      const createdAt: Record<string, Date> = {};
      if (params.startDate) { createdAt.gte = new Date(params.startDate); }
      if (params.endDate) { createdAt.lte = new Date(params.endDate); }
      where.createdAt = createdAt;
    }

    try {
      const [totalLogs, allLogs] = await Promise.all([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.findMany({
          where, orderBy: { createdAt: 'desc' }, take: 10000,
          select: { action: true, resource: true, category: true, userId: true, adminId: true, createdAt: true } as any,
        }),
      ]);

      const actionMap = new Map<string, number>();
      const userMap = new Map<string, number>();
      const categoryMap = new Map<string, number>();
      let failureCount = 0;
      let successCount = 0;
      const dateMap = new Map<string, number>();

      for (const log of allLogs) {
        const entry = log as any;
        actionMap.set(entry.action, (actionMap.get(entry.action) || 0) + 1);
        const uid = entry.userId || entry.adminId || 'system';
        userMap.set(uid, (userMap.get(uid) || 0) + 1);
        const cat = entry.category || 'general';
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
        if (entry.action === 'login_failed') { failureCount++; } else { successCount++; }
        const dateKey = entry.createdAt.toISOString().split('T')[0];
        dateMap.set(dateKey, (dateMap.get(dateKey) || 0) + 1);
      }

      return {
        totalLogs,
        byAction: Array.from(actionMap.entries()).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
        byUser: Array.from(userMap.entries()).map(([userId, count]) => ({ userId, userName: userId, count })).sort((a, b) => b.count - a.count),
        byCategory: Array.from(categoryMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
        byResourceType: Array.from(new Map<string, number>().entries()).map(([resourceType, count]) => ({ resourceType, count })),
        byStatus: [{ status: 'success', count: successCount }, { status: 'failure', count: failureCount }],
        timeline: Array.from(dateMap.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)).slice(-30),
      };
    } catch (error) {
      this.logger.error(`Failed to get audit log stats: ${error.message}`);
      return { totalLogs: 0, byAction: [], byUser: [], byCategory: [], byResourceType: [], byStatus: [{ status: 'success', count: 0 }, { status: 'failure', count: 0 }], timeline: [] };
    }
  }

  async getLogById(id: string, tenantId?: string) {
    const where: Record<string, unknown> = { id };
    if (tenantId) { where.tenantId = tenantId; }
    const log = await this.prisma.auditLog.findFirst({ where });
    if (!log) { return null; }

    const userIds = log.userId ? [log.userId] : [];
    const adminIds = log.adminId ? [log.adminId] : [];
    const { userMap, adminMap } = await this.resolveUserNames(userIds, adminIds);
    const info = log.userId ? userMap.get(log.userId) : log.adminId ? adminMap.get(log.adminId) : undefined;
    return this.transformLogEntry(log, info);
  }

  async exportLogs(query: AuditLogQueryDto, tenantId?: string): Promise<string> {
    const where: Record<string, unknown> = {};
    if (tenantId) { where.tenantId = tenantId; }
    if (query.action) { where.action = query.action; }
    if (query.resource) { where.resource = query.resource; }
    if (query.category) { where.category = query.category; }
    if (query.startDate || query.endDate) {
      const createdAt: Record<string, Date> = {};
      if (query.startDate) { createdAt.gte = new Date(query.startDate); }
      if (query.endDate) { createdAt.lte = new Date(query.endDate); }
      where.createdAt = createdAt;
    }

    const logs = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10000 });
    const headers = ['ID', 'Timestamp', 'Action', 'Resource', 'Category', 'Resource ID', 'User ID', 'Admin ID', 'IP Address', 'Description'];
    const rows = logs.map((log: any) => [
      log.id, log.createdAt.toISOString(), log.action, log.resource, log.category || 'general',
      log.resourceId || '', log.userId || '', log.adminId || '', log.ipAddress || '', log.description || '',
    ]);
    return [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
  }

  async cleanupOldLogs(retentionDays: number = 180): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const result = await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoffDate } } });
    this.logger.log(`Deleted ${result.count} audit logs older than ${retentionDays} days`);
    return result.count;
  }
}
