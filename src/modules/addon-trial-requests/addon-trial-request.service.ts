import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTrialRequestDto } from './dto/create-trial-request.dto';
import { AdminReviewTrialRequestDto } from './dto/admin-review.dto';
import { AddonService } from '@/modules/addons/addon.service';

export type TrialRequestStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface TrialRequestEntity {
  id: string;
  tenantId: string;
  addonCode: string;
  addonName: string | null;
  status: TrialRequestStatus;
  note: string | null;
  adminNote: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AddonTrialRequestService {
  private readonly logger = new Logger(AddonTrialRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  // ── Prisma client helper (type-loose to survive pre-generate builds) ────────
  private db(): any {
    return (this.prisma as unknown as { addon_trial_requests: any }).addon_trial_requests;
  }

  private notificationsDb(): any {
    return (this.prisma as unknown as { notification: any }).notification;
  }

  // ─── Tenant endpoints ───────────────────────────────────────────────────────

  /**
   * Tenant ขอทดลองใช้ add-on
   * - ไม่อนุญาตถ้ามี pending หรือ approved (ยัง active) อยู่แล้ว
   */
  async createRequest(tenantId: string, dto: CreateTrialRequestDto): Promise<TrialRequestEntity> {
    // ตรวจสอบว่า addon code นี้มีอยู่จริง
    const catalog = await this.addonService.listActive();
    const addonInfo = catalog.find((a) => a.code === dto.addonCode);
    if (!addonInfo) {
      throw new NotFoundException(`Add-on "${dto.addonCode}" not found or inactive`);
    }

    // โมดูลคนละสายธุรกิจขอทดลองใช้ไม่ได้ (โรงแรมขอ CAMP_MODULE ไม่ได้ และกลับกัน)
    await this.addonService.assertAddonAllowedForTenant(tenantId, dto.addonCode);

    // ตรวจสอบว่ายังไม่มี pending/approved request สำหรับ addon นี้
    // approved ที่ "หมดอายุแล้วแต่ cron ยังไม่ได้ปั๊ม expired" ต้องไม่บล็อกคำขอใหม่
    // (เงื่อนไขคือวันหมดอายุ ไม่ใช่สถานะ — ตรงกับ getActiveAddons)
    const existing = await this.db().findFirst({
      where: {
        tenant_id: tenantId,
        addon_code: dto.addonCode,
        OR: [
          { status: 'pending' },
          { status: 'approved', expires_at: { gt: new Date() } },
        ],
      },
    });

    if (existing) {
      const msg =
        existing.status === 'pending'
          ? `มีคำขอทดลองใช้ ${dto.addonCode} รออนุมัติอยู่แล้ว`
          : `กำลังทดลองใช้ ${dto.addonCode} อยู่แล้ว`;
      throw new ConflictException(msg);
    }

    // ตรวจสอบว่า tenant ไม่ได้ใช้ add-on นี้ใน subscription อยู่แล้ว
    const activeAddons = await this.addonService.getActiveAddons(tenantId);
    if (activeAddons.some((a) => a.code === dto.addonCode && a.isActive)) {
      throw new ConflictException(`Add-on ${dto.addonCode} เปิดใช้งานอยู่แล้วในแพ็กเกจของคุณ`);
    }

    const record = await this.db().create({
      data: {
        tenant_id: tenantId,
        addon_code: dto.addonCode,
        addon_name: addonInfo.name,
        status: 'pending',
        note: dto.note ?? null,
      },
    });

    this.logger.log(
      `Trial request created: tenant=${tenantId} addon=${dto.addonCode} id=${record.id}`,
    );

    return this.toEntity(record);
  }

  /** รายการคำขอของ tenant นี้ */
  async findByTenant(tenantId: string): Promise<TrialRequestEntity[]> {
    const records = await this.db().findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
    });
    return records.map((r: any) => this.toEntity(r));
  }

  // ─── Admin endpoints ────────────────────────────────────────────────────────

  /** Admin ดู request ทั้งหมด พร้อม filter */
  async findAll(query: { status?: TrialRequestStatus; page?: number; limit?: number }): Promise<{
    items: TrialRequestEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: any = {};
    if (query.status) where.status = query.status;

    const [records, total] = await this.prisma.$transaction([
      this.db().findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db().count({ where }),
    ]);

    return {
      items: records.map((r: any) => this.toEntity(r)),
      meta: { page, limit, total },
    };
  }

  /** Admin อนุมัติ request → activate addon ชั่วคราว + แจ้ง notification */
  async approve(
    requestId: string,
    adminUserId: string,
    dto: AdminReviewTrialRequestDto,
  ): Promise<TrialRequestEntity> {
    const request = await this.db().findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Trial request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    // ผู้เช่าอาจย้ายแผนหลังยื่นคำขอ — เช็คสายธุรกิจอีกครั้งตอนอนุมัติ ไม่ใช่เชื่อ
    // ว่าตอนสร้างคำขอเคยผ่านแล้ว
    await this.addonService.assertAddonAllowedForTenant(request.tenant_id, request.addon_code);

    const trialDays = dto.trialDays ?? 14;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + trialDays);

    // 1) อัพเดต request status — แถวนี้ "คือ" ตัว entitlement เลย ไม่ได้เป็นแค่ใบคำขอ:
    //    AddonService.getActiveAddons() อ่าน approved + expires_at > now โดยตรง
    //    จึงไม่ต้องคัดลอกไปที่ subscription_features (ตารางนั้นไม่มีคอลัมน์วันหมดอายุ
    //    และถูกใช้ออกใบแจ้งหนี้ — ของทดลองใช้ลงไปแล้วจะกลายเป็นถาวรและโดนเก็บเงิน)
    const updated = await this.db().update({
      where: { id: requestId },
      data: {
        status: 'approved',
        admin_note: dto.adminNote ?? null,
        approved_by: adminUserId,
        approved_at: new Date(),
        expires_at: expiresAt,
      },
    });

    // 2) ล้าง addon cache — ถ้าพลาดตรงนี้ต้องโยน error ออกไป ห้ามกลืน:
    //    tenant จะเห็นสิทธิ์ใหม่ช้าไปถึง 5 นาที (TTL) ทั้งที่ admin เห็นว่า "อนุมัติแล้ว"
    await this.addonService.invalidateAddonCache(request.tenant_id);

    // 3) สร้าง in-app notification ให้ tenant
    await this.sendApprovalNotification(
      request.tenant_id,
      request.addon_name ?? request.addon_code,
      trialDays,
      dto.adminNote,
    );

    this.logger.log(
      `Trial request approved: id=${requestId} tenant=${request.tenant_id} addon=${request.addon_code} days=${trialDays}`,
    );

    return this.toEntity(updated);
  }

  /** Admin ปฏิเสธ request + แจ้ง notification */
  async reject(
    requestId: string,
    adminUserId: string,
    dto: AdminReviewTrialRequestDto,
  ): Promise<TrialRequestEntity> {
    const request = await this.db().findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException(`Trial request ${requestId} not found`);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    const updated = await this.db().update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        admin_note: dto.adminNote ?? null,
        approved_by: adminUserId,
        approved_at: new Date(),
      },
    });

    // แจ้ง notification ปฏิเสธ
    await this.sendRejectionNotification(
      request.tenant_id,
      request.addon_name ?? request.addon_code,
      dto.adminNote,
    );

    this.logger.log(
      `Trial request rejected: id=${requestId} tenant=${request.tenant_id} addon=${request.addon_code}`,
    );

    return this.toEntity(updated);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async sendApprovalNotification(
    tenantId: string,
    addonName: string,
    trialDays: number,
    adminNote?: string | null,
  ): Promise<void> {
    try {
      const message = adminNote
        ? `คำขอทดลองใช้ "${addonName}" ได้รับการอนุมัติแล้ว! คุณสามารถใช้งานได้ ${trialDays} วัน\n\nหมายเหตุจาก Admin: ${adminNote}`
        : `คำขอทดลองใช้ "${addonName}" ได้รับการอนุมัติแล้ว! คุณสามารถใช้งานได้ ${trialDays} วัน เริ่มได้เลยค่ะ`;

      await this.notificationsDb().create({
        data: {
          tenantId,
          title: `✅ อนุมัติการทดลองใช้ ${addonName}`,
          message,
          type: 'success',
          category: 'addon_trial',
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to send approval notification for tenant ${tenantId}:`, error);
    }
  }

  private async sendRejectionNotification(
    tenantId: string,
    addonName: string,
    adminNote?: string | null,
  ): Promise<void> {
    try {
      const message = adminNote
        ? `คำขอทดลองใช้ "${addonName}" ไม่ได้รับการอนุมัติในครั้งนี้\n\nหมายเหตุ: ${adminNote}`
        : `คำขอทดลองใช้ "${addonName}" ไม่ได้รับการอนุมัติในครั้งนี้ หากมีข้อสงสัยกรุณาติดต่อทีมงาน`;

      await this.notificationsDb().create({
        data: {
          tenantId,
          title: `❌ ไม่อนุมัติการทดลองใช้ ${addonName}`,
          message,
          type: 'warning',
          category: 'addon_trial',
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to send rejection notification for tenant ${tenantId}:`, error);
    }
  }

  private toEntity(r: any): TrialRequestEntity {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      addonCode: r.addon_code,
      addonName: r.addon_name,
      status: r.status as TrialRequestStatus,
      note: r.note,
      adminNote: r.admin_note,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at ? (r.approved_at as Date).toISOString() : null,
      expiresAt: r.expires_at ? (r.expires_at as Date).toISOString() : null,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }
}
