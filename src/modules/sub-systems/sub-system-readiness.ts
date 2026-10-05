import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Per-terminal setup readiness.
 *
 * Entitlement (add-on / plan) says a tenant *may* open a terminal; this says
 * whether there is anything in it to open. A terminal with no master data is a
 * dead end for staff — POS with no restaurant, a campground terminal with no
 * pitches — so the console warns the owner and SSO launch is refused until the
 * listed items are set up.
 *
 * Only terminals whose minimum data is unambiguous are modelled. Everything
 * else reports `ready: true` rather than guessing at a requirement.
 */
export interface SubSystemSetupItem {
  /** Stable machine code, e.g. NO_RESTAURANT. */
  code: string;
  /** Owner-facing sentence (Thai). */
  message: string;
  /** Console page where the owner fixes it. */
  setupHref: string;
}

export interface SubSystemReadiness {
  ready: boolean;
  missing: SubSystemSetupItem[];
}

export type SubSystemReadinessMap = Record<string, SubSystemReadiness>;

export const SUB_SYSTEM_NOT_READY = 'SUB_SYSTEM_NOT_READY';

const NO_RESTAURANT: SubSystemSetupItem = {
  code: 'NO_RESTAURANT',
  message: 'ยังไม่มีร้านอาหาร — สร้างร้านก่อนเปิดใช้งาน',
  setupHref: '/dashboard/restaurant',
};
const NO_MENU: SubSystemSetupItem = {
  code: 'NO_MENU',
  message: 'ยังไม่มีเมนูอาหาร — เพิ่มเมนูอย่างน้อย 1 รายการ',
  setupHref: '/dashboard/restaurant/menu',
};
const NO_CAMPGROUND: SubSystemSetupItem = {
  code: 'NO_CAMPGROUND',
  message: 'ยังไม่มีลานกางเต็นท์ — สร้างลานก่อนเปิดใช้งาน',
  setupHref: '/dashboard/camp/setup',
};
const NO_PITCH: SubSystemSetupItem = {
  code: 'NO_PITCH',
  message: 'ยังไม่มีจุดกางเต็นท์ — เพิ่มโซนและจุดกางเต็นท์อย่างน้อย 1 จุด',
  setupHref: '/dashboard/camp/setup',
};
const NO_PROPERTY: SubSystemSetupItem = {
  code: 'NO_PROPERTY',
  message: 'ยังไม่มีข้อมูลโรงแรม — ตั้งค่าโรงแรมก่อนเปิดใช้งาน',
  setupHref: '/dashboard/getting-started',
};
const NO_ROOM: SubSystemSetupItem = {
  code: 'NO_ROOM',
  message: 'ยังไม่มีห้องพัก — เพิ่มห้องพักอย่างน้อย 1 ห้อง',
  setupHref: '/dashboard/rooms',
};

type ReadinessPrisma = Pick<
  PrismaService,
  'restaurant' | 'menuItem' | 'campground' | 'campPitch' | 'property' | 'room'
>;

const toReadiness = (missing: SubSystemSetupItem[]): SubSystemReadiness => ({
  ready: missing.length === 0,
  missing,
});

/** Readiness of every modelled terminal for one tenant, keyed by sub-system id. */
export async function getSubSystemReadiness(
  prisma: ReadinessPrisma,
  tenantId: string,
): Promise<SubSystemReadinessMap> {
  if (!tenantId) return {};
  const [restaurants, menuItems, campgrounds, pitches, properties, rooms] = await Promise.all([
    prisma.restaurant.count({ where: { tenantId } }),
    prisma.menuItem.count({ where: { tenantId } }),
    prisma.campground.count({ where: { tenantId } }),
    prisma.campPitch.count({ where: { tenantId } }),
    prisma.property.count({ where: { tenantId } }),
    prisma.room.count({ where: { tenantId } }),
  ]);

  // A later step is only reported once the one before it is done, so the owner
  // sees one next action instead of a wall of them.
  const restaurantGap = restaurants === 0 ? [NO_RESTAURANT] : [];
  return {
    pos: toReadiness(restaurants === 0 ? [NO_RESTAURANT] : menuItems === 0 ? [NO_MENU] : []),
    // The kitchen screen only mirrors orders — it has nothing to show without a
    // restaurant, but does not itself need a menu to open.
    'pos-kitchen': toReadiness(restaurantGap),
    'camp-terminal': toReadiness(
      campgrounds === 0 ? [NO_CAMPGROUND] : pitches === 0 ? [NO_PITCH] : [],
    ),
    'hotel-terminal': toReadiness(properties === 0 ? [NO_PROPERTY] : rooms === 0 ? [NO_ROOM] : []),
  };
}

/** Refuse an SSO hand-off into a terminal that still needs setup (409). */
export async function assertSubSystemReady(
  prisma: ReadinessPrisma,
  tenantId: string,
  subSystemId: string,
): Promise<void> {
  const readiness = (await getSubSystemReadiness(prisma, tenantId))[subSystemId];
  if (!readiness || readiness.ready) return;
  throw new ConflictException({
    code: SUB_SYSTEM_NOT_READY,
    message: readiness.missing[0].message,
    subSystem: subSystemId,
    missing: readiness.missing,
  });
}
