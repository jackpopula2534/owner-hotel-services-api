/**
 * เว็บไซต์โรงแรม (add-on WEBSITE_BUILDER) — ค่าคงที่ที่ใช้ร่วมกันทั้งฝั่ง admin และ public
 */

export const WEBSITE_ADDON_CODE = 'WEBSITE_BUILDER' as const;

export const SITE_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

export const TEMPLATE_KEYS = ['classic', 'fresh'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const SITE_LANGS = ['th', 'en'] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

export const SECTION_TYPES = [
  'hero',
  'rooms',
  'offers',
  'gallery',
  'dining',
  'reviews',
  'location',
  'contact',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const INQUIRY_TYPES = ['CONTACT', 'BOOKING_REQUEST'] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];

export const INQUIRY_STATUSES = ['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** คนที่แก้เว็บได้ */
export const SITE_EDITOR_ROLES = [
  'admin',
  'tenant_admin',
  'platform_admin',
  'manager',
  'hotel_manager',
] as const;

/** คนที่ดู/ตอบกล่องคำขอได้ (เพิ่มพนักงานต้อนรับ) */
export const INQUIRY_ROLES = [...SITE_EDITOR_ROLES, 'receptionist'] as const;

/** ผู้รับแจ้งเตือนเมื่อมีคำขอใหม่เข้ามา */
export const INQUIRY_NOTIFY_ROLES = [
  'admin',
  'tenant_admin',
  'manager',
  'hotel_manager',
  'receptionist',
];

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * subdomain ที่ห้ามโรงแรมจองไป — ชนกับระบบเรา หรือหลอกคนว่าเป็นหน้าทางการ
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'administrator',
  'dashboard',
  'staging',
  'dev',
  'test',
  'demo',
  'mail',
  'email',
  'smtp',
  'ftp',
  'static',
  'assets',
  'cdn',
  'media',
  'img',
  'images',
  'uploads',
  'help',
  'support',
  'status',
  'docs',
  'blog',
  'billing',
  'pay',
  'payment',
  'payments',
  'login',
  'auth',
  'account',
  'accounts',
  'secure',
  'security',
  'staysync',
  'campsync',
  'hotel',
  'hotels',
  'booking',
  'bookings',
  'pos',
  'hr',
  'inventory',
  'accounting',
  'purchasing',
  'crm',
  'kitchen',
  'terminal',
  'portal',
  'supplier',
  'suppliers',
  'jobs',
  'careers',
  'site',
  'sites',
  'official',
  'root',
  'system',
]);

/** ตัดช่องว่าง + ตัวพิมพ์เล็ก — ไม่แปลงอักขระอื่นให้ เพื่อไม่ให้ slug ที่ได้ต่างจากที่ผู้ใช้เห็น */
export function normalizeSlug(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

/** คืนเหตุผลที่ใช้ไม่ได้ (ภาษาไทย) หรือ null ถ้าผ่าน */
export function validateSlug(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return `ชื่อเว็บต้องยาว ${SLUG_MIN}-${SLUG_MAX} ตัวอักษร`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'ใช้ได้เฉพาะ a-z, 0-9 และขีด (-) และห้ามขึ้นต้น/ลงท้ายด้วยขีด';
  }
  if (slug.includes('--')) {
    return 'ห้ามมีขีดติดกันสองตัว';
  }
  if (RESERVED_SLUGS.has(slug)) {
    return 'ชื่อนี้สงวนไว้สำหรับระบบ';
  }
  return null;
}
