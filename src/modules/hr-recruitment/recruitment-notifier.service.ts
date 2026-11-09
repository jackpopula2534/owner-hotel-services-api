import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EmailService } from '../../email/email.service';
import { EmailTemplate } from '../../email/dto/send-email.dto';
import { SmsChannelAdapter } from '../crm/automation/channels/sms.adapter';
import { ApproverRole } from '../../common/types/approval-chain';

/** หมวดกระดิ่งของโมดูลผู้รับ — งานสรรหาขึ้นที่กระดิ่ง HR */
export const HR_NOTIFICATION_CATEGORY = 'hr';

/**
 * ขั้นอนุมัติ (dept_head/hr/owner) → user role ที่ถือว่าเป็นผู้อนุมัติขั้นนั้น
 * — chain ไม่ผูก user รายคน จึงแจ้งทุกคนใน tenant ที่ถือ role ดังกล่าว
 */
export const APPROVER_USER_ROLES: Record<ApproverRole, string[]> = {
  dept_head: ['manager', 'hotel_manager'],
  hr: ['hr', 'hr_manager'],
  owner: ['owner', 'tenant_admin', 'admin'],
};

const FORMAT_LABELS: Record<string, string> = {
  onsite: 'สัมภาษณ์ที่สถานที่',
  video: 'วิดีโอคอล',
  phone: 'โทรศัพท์',
};

const SEND_TIMEOUT_MS = 5000;

export interface InterviewInvite {
  tenantId: string;
  candidate: { firstName: string; lastName: string; email?: string | null; phone?: string | null };
  positionTitle: string;
  round: number;
  scheduledAt: Date;
  durationMinutes: number;
  format?: string | null;
  location?: string | null;
}

/**
 * ช่องทางแจ้งเตือนของงานสรรหา: กระดิ่งในแอป (ผู้อนุมัติ) + อีเมล/SMS (ผู้สมัคร)
 * ทุกเมธอด "ไม่ throw" — การแจ้งเตือนล้มต้องไม่ทำให้ธุรกรรมหลักล้ม
 */
@Injectable()
export class RecruitmentNotifierService {
  private readonly logger = new Logger(RecruitmentNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly sms: SmsChannelAdapter,
  ) {}

  /** user ids (active, tenant เดียวกัน) ที่ถือ role ของขั้นอนุมัตินั้น */
  async resolveApproverUserIds(tenantId: string, role: ApproverRole): Promise<string[]> {
    const userRoles = APPROVER_USER_ROLES[role] ?? [];
    if (!userRoles.length) return [];
    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: userRoles }, status: 'active' },
      select: { id: true },
      take: 50,
    });
    return users.map((u) => u.id);
  }

  /** สร้างแจ้งเตือนในแอปให้หลายคน — คืนจำนวนที่สร้างสำเร็จ */
  async notifyUsers(
    tenantId: string,
    userIds: string[],
    payload: { title: string; message: string; link: string; type?: string },
  ): Promise<number> {
    const results = await Promise.allSettled(
      userIds.map((userId) =>
        this.notifications.create({
          userId,
          tenantId,
          title: payload.title,
          message: payload.message,
          type: payload.type ?? 'info',
          category: HR_NOTIFICATION_CATEGORY,
          link: payload.link,
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) this.logger.warn(`notifyUsers: ${failed.length}/${userIds.length} failed`);
    return results.length - failed.length;
  }

  /**
   * แจ้งผู้สมัครเรื่องนัดสัมภาษณ์ (อีเมลถ้ามี + SMS ถ้ามีเบอร์)
   * คืน true เมื่ออย่างน้อยหนึ่งช่องทางส่ง/เข้าคิวสำเร็จ
   */
  async notifyCandidateInterview(invite: InterviewInvite): Promise<boolean> {
    const name = `${invite.candidate.firstName} ${invite.candidate.lastName}`.trim();
    const when = invite.scheduledAt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
    const formatLabel = FORMAT_LABELS[invite.format ?? ''] ?? FORMAT_LABELS.onsite;
    let delivered = false;

    if (invite.candidate.email) {
      try {
        const res = await this.withTimeout(
          this.email.sendEmail({
            to: invite.candidate.email,
            subject: `นัดสัมภาษณ์งาน ${invite.positionTitle}`,
            template: EmailTemplate.INTERVIEW_INVITATION,
            context: {
              candidateName: name,
              positionTitle: invite.positionTitle,
              round: invite.round,
              when,
              durationMinutes: invite.durationMinutes,
              formatLabel,
              location: invite.location ?? null,
            },
            language: 'th',
            tenantId: invite.tenantId,
          }),
        );
        delivered = delivered || !!res?.success;
      } catch (e) {
        this.logger.warn(`interview email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const phone = invite.candidate.phone?.replace(/[\s-]/g, '');
    if (phone) {
      try {
        const res = await this.sms.send({
          tenantId: invite.tenantId,
          recipient: phone,
          guestId: null,
          subject: null,
          templateKey: null,
          bodyOverride: `นัดสัมภาษณ์ ${invite.positionTitle} ${when} (${invite.durationMinutes} นาที, ${formatLabel})${invite.location ? ` ${invite.location}` : ''}`,
        });
        delivered = delivered || res.success;
      } catch (e) {
        this.logger.warn(`interview sms failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return delivered;
  }

  /** คิวอีเมล (Bull) อาจค้างถ้า Redis ล่ม — ตัดที่ 5 วินาทีไม่ให้ลากคำขอหลัก */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), SEND_TIMEOUT_MS);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
