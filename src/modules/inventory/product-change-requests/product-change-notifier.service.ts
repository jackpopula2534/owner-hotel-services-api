import { Injectable, Logger } from '@nestjs/common';
import { ProductChangeRequest } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { AuditAction, AuditCategory, AuditResource } from '@/audit-log/dto/audit-log.dto';
import { REVIEWER_ROLES, type ChangeRequestActor } from './product-change-access';

/** platform_admin ไม่ใช่คนของโรงแรม — ไม่ต้องรับแจ้งเตือนงานประจำวัน */
const REVIEWER_NOTIFY_ROLES = [...REVIEWER_ROLES].filter((r) => r !== 'platform_admin');

/**
 * แจ้งเตือน + audit log ของคำขอสินค้า
 * ทุกเมธอดกลืน error เอง — การแจ้งเตือนล้มต้องไม่ทำให้การอนุมัติล้มตาม
 */
@Injectable()
export class ProductChangeNotifierService {
  private readonly logger = new Logger(ProductChangeNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** ชื่อผู้ใช้สำหรับ timeline — User เป็น tenant-scoped จึงต้องกรอง tenantId (ห้าม findUnique) */
  async nameOf(actor: Pick<ChangeRequestActor, 'userId' | 'tenantId'>): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, tenantId: actor.tenantId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!user) return null;
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return full || user.email;
  }

  /**
   * แจ้งฝั่งคลัง = ทุกคนที่มีสิทธิ์พิจารณา (หัวหน้าคลัง + เจ้าของ/แอดมิน)
   * — โรงแรมเล็กไม่มี warehouse_manager เจ้าของคือคนอนุมัติ ถ้าแจ้งแค่ warehouse_manager จะไม่มีใครรู้
   * — ไม่ตัดผู้ส่งออก: คนที่ส่งแล้วอยู่ใน role ผู้พิจารณาได้คือเจ้าของที่อนุมัติเองได้ (SELF_REVIEW_ROLES)
   *   งานนี้ต้องขึ้นในกระดิ่งคลังของเขาเหมือนกัน (buyer/procurement ไม่อยู่ใน role นี้อยู่แล้ว)
   * ขึ้นที่กระดิ่งของระบบคลัง (category 'inventory')
   */
  async notifyReviewers(request: ProductChangeRequest, message: string): Promise<void> {
    try {
      const reviewers = await this.prisma.user.findMany({
        where: {
          tenantId: request.tenantId,
          role: { in: REVIEWER_NOTIFY_ROLES },
          status: 'active',
        },
        select: { id: true },
        take: 50,
      });
      await Promise.all(
        reviewers.map((r) =>
          this.notifications.create({
            userId: r.id,
            tenantId: request.tenantId,
            title: `คำขอสินค้าจากจัดซื้อ ${request.requestNumber}`,
            message,
            type: 'info',
            category: 'inventory',
            link: `/inventory/product-requests/${request.id}`,
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `notifyReviewers failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** แจ้งผู้ส่งคำขอ — ขึ้นที่กระดิ่งของระบบจัดซื้อ (category 'procurement') */
  async notifyRequester(
    request: ProductChangeRequest,
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
  ): Promise<void> {
    try {
      await this.notifications.create({
        userId: request.requestedById,
        tenantId: request.tenantId,
        title: `คำขอสินค้า ${request.requestNumber}`,
        message,
        type,
        category: 'procurement',
        link: `/purchasing/product-requests/${request.id}`,
      });
    } catch (error) {
      this.logger.warn(
        `notifyRequester failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async audit(
    actor: ChangeRequestActor,
    request: ProductChangeRequest,
    verb: string,
  ): Promise<void> {
    await this.auditLog.log({
      action: AuditAction.UPDATE,
      resource: AuditResource.PRODUCT_CHANGE_REQUEST,
      resourceId: request.id,
      category: AuditCategory.PROCUREMENT,
      tenantId: actor.tenantId,
      userId: actor.userId,
      description: `Product change request ${request.requestNumber} (${request.type}) ${verb}`,
    });
  }
}
