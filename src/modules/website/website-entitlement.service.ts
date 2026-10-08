import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import { WEBSITE_ADDON_CODE } from './website.constants';

export type PublishBlockReason = 'TRIAL' | 'WRONG_PRODUCT_LINE' | 'ADDON_REQUIRED';

export interface PublishEligibility {
  ok: boolean;
  reason?: PublishBlockReason;
}

/**
 * สิทธิ์ "ออนไลน์ได้" ของเว็บโรงแรม — ใช้ทั้งตอนกด Publish และทุกครั้งที่หน้าเว็บสาธารณะถูกเปิด
 *
 * ทำไมไม่พึ่ง AddonGuard: guard ปล่อย role `admin` และ tenant ที่อยู่ช่วง trial ผ่านทั้งหมด
 * (และหน้า public ไม่มี user ให้ guard ดูเลย) ถ้าใช้ guard อย่างเดียว tenant ที่สมัคร trial
 * จะเปิดเว็บสาธารณะใต้โดเมนเราได้ฟรี 14 วันแล้วทิ้ง → เสี่ยง spam/SEO ของทั้งโดเมน
 * กติกาจึงเป็น: trial แก้และ preview ได้ (ผ่าน guard) แต่ publish / ออนไลน์ไม่ได้
 *
 * ไม่ cache ผลแยกเอง — hasActiveAddon / isAddonAllowedForTenant ใช้ cache ของ AddonService
 * ซึ่งถูกล้างด้วย invalidateAddonCache ทุกครั้งที่ subscription เปลี่ยน
 */
@Injectable()
export class WebsiteEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  async checkPublishable(tenantId: string): Promise<PublishEligibility> {
    // ดู subscription ล่าสุดทุกสถานะ แบบเดียวกับ AddonGuard ขั้นที่ 6
    const latest = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId },
      select: { status: true },
      orderBy: { created_at: 'desc' },
    });
    if (latest?.status === 'trial') return { ok: false, reason: 'TRIAL' };

    const allowedForLine = await this.addonService.isAddonAllowedForTenant(
      tenantId,
      WEBSITE_ADDON_CODE,
    );
    if (!allowedForLine) return { ok: false, reason: 'WRONG_PRODUCT_LINE' };

    const hasAddon = await this.addonService.hasActiveAddon(tenantId, WEBSITE_ADDON_CODE);
    if (!hasAddon) return { ok: false, reason: 'ADDON_REQUIRED' };

    return { ok: true };
  }

  async isLive(tenantId: string): Promise<boolean> {
    return (await this.checkPublishable(tenantId)).ok;
  }
}
