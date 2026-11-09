import { Injectable, Logger } from '@nestjs/common';
import { ItemUnit, Prisma, WarehouseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { quoteCampStay } from '../modules/camp/camp-pricing';
import {
  hasPostableRevenue,
  RevenuePostingService,
} from '../modules/revenue/revenue-posting.service';
import {
  buildCampRevenueInput,
  CAMP_REVENUE_SELECT,
} from '../modules/revenue/sources/camp-revenue.source';
import {
  buildDefaultContent,
  CAMP_DEFAULT_GALLERY_IMAGES,
  sanitizeSeo,
  sanitizeSiteContent,
  sanitizeTheme,
} from '../modules/website/website-content';
import {
  CAMP_ADDRESS,
  CAMP_EMAIL,
  CAMP_NAME,
  CAMP_PHONE,
  EQUIPMENT,
  EquipmentKey,
  FACILITIES,
  MAP_HEIGHT,
  MAP_IMAGE_URL,
  MAP_WIDTH,
  mapPos,
  RESERVATIONS,
  SITE_SLUG,
  ZONES,
  ZoneSeed,
} from './camp-premium.data';

/**
 * ลานทดสอบแพ็กใหญ่สุด (CAMP_PLUS) — คู่ของ premium.test@email.com ฝั่งโรงแรม
 * tenant/owner/subscription สร้างใน seedAdminPanelTestData (ชื่อต้องตรงกับค่านี้)
 * ไฟล์นี้เติมข้อมูลลานให้ครบทุกหน้าจอ: โซน จุดกาง สิ่งอำนวยความสะดวก อุปกรณ์ให้เช่า การจองทุกสถานะ เว็บไซต์
 */
export const CAMP_PREMIUM_TENANT_NAME = 'Pine Valley Camp (Premium Camp Test)';

const asJson = <T>(v: T): Prisma.InputJsonValue => v as unknown as Prisma.InputJsonValue;

const DAY_MS = 24 * 60 * 60 * 1000;

/** วันที่แบบ date-only (UTC midnight) ห่างจากวันนี้ offset วัน — ตรงกับที่ ReservationsService เก็บ */
function utcDay(offset: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset * DAY_MS,
  );
}

/** เวลาไทย (UTC+7) ของวันที่ date-only นั้น เช่น 13:00 → 06:00Z */
function atBangkok(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getTime() + (h - 7) * 60 * 60 * 1000 + m * 60 * 1000);
}

const ymd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '');

/** สถานะใบจองที่ของยังอยู่กับแขก — ตรงกับ AddonsService.ACTIVE_RESERVATION_STATUSES */
const GEAR_OUT_STATUSES = ['pending', 'confirmed', 'checked_in'];

/**
 * สินค้าคลังของอุปกรณ์เช่าแต่ละตัว — หน่วยนับคลัง + ต้นทุนต่อหน่วย + ยอดสำรองในคลังกลาง (WH-MAIN)
 * ไว้ทดสอบใบเบิก/ใบโอนเติมของเข้าลาน (เก้าอี้หมดที่ลานแต่คลังกลางยังมี)
 */
const GEAR_INVENTORY: Record<EquipmentKey, { unit: ItemUnit; cost: number; centralQty: number }> = {
  tent2: { unit: ItemUnit.PIECE, cost: 1800, centralQty: 5 },
  tent4: { unit: ItemUnit.PIECE, cost: 3500, centralQty: 2 },
  bag: { unit: ItemUnit.PIECE, cost: 450, centralQty: 10 },
  mat: { unit: ItemUnit.PIECE, cost: 350, centralQty: 10 },
  stove: { unit: ItemUnit.SET, cost: 900, centralQty: 4 },
  wood: { unit: ItemUnit.PACK, cost: 40, centralQty: 50 },
  lantern: { unit: ItemUnit.PIECE, cost: 250, centralQty: 10 },
  cord: { unit: ItemUnit.PIECE, cost: 300, centralQty: 5 },
  chair: { unit: ItemUnit.PIECE, cost: 400, centralQty: 12 },
};

@Injectable()
export class CampPremiumSeeder {
  private readonly logger = new Logger(CampPremiumSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenuePosting: RevenuePostingService,
  ) {}

  async seed(): Promise<void> {
    this.logger.log('🏕️  Seeding Premium Camp test data...');
    try {
      const tenant = await this.prisma.tenants.findFirst({
        where: { name: CAMP_PREMIUM_TENANT_NAME },
        select: { id: true },
      });
      if (!tenant) {
        this.logger.warn('  ⚠️ Premium camp tenant not found, skipping');
        return;
      }
      // subscriptions.service สร้างลานว่างให้อัตโนมัติตอนสมัครแพ็กลาน → เติมข้อมูลลงลานนั้น
      const existing = await this.prisma.campground.findFirst({
        where: { tenantId: tenant.id },
        include: { _count: { select: { zones: true } } },
      });
      if (existing && existing._count.zones > 0) {
        this.logger.log('  ⊙ Premium camp already seeded');
        return;
      }
      const property = await this.prisma.property.findFirst({
        where: { tenantId: tenant.id, isDefault: true, deletedAt: null },
      });
      if (!property) {
        this.logger.warn('  ⚠️ Premium camp property not found, skipping');
        return;
      }

      const campgroundData = {
        name: CAMP_NAME,
        description:
          'ลานกางเต็นท์บนเนินเขาปากช่อง อากาศเย็นทั้งปี มีโซนริมทะเลสาบ ริมลำธาร รถบ้าน และแกลมปิ้ง',
        address: CAMP_ADDRESS,
        phone: CAMP_PHONE,
        latitude: 14.5155,
        longitude: 101.3712,
        images: asJson(CAMP_DEFAULT_GALLERY_IMAGES.slice(0, 4)),
        status: 'active',
        checkInTime: '13:00',
        checkOutTime: '11:00',
        mapImageUrl: MAP_IMAGE_URL,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT,
      };
      const campground = existing
        ? await this.prisma.campground.update({ where: { id: existing.id }, data: campgroundData })
        : await this.prisma.campground.create({ data: { tenantId: tenant.id, ...campgroundData } });
      await this.prisma.property.update({
        where: { id: property.id },
        data: { name: CAMP_NAME, location: CAMP_ADDRESS },
      });

      const pitchByCode = await this.seedZonesAndPitches(tenant.id, campground.id);
      await this.prisma.campFacility.createMany({
        data: FACILITIES.map((f) => ({
          tenantId: tenant.id,
          campgroundId: campground.id,
          name: f.name,
          type: f.type,
          status: 'open',
          ...mapPos(f.x, f.y),
          openingTime: 'openingTime' in f ? f.openingTime : null,
          closingTime: 'closingTime' in f ? f.closingTime : null,
          open24h: 'open24h' in f ? f.open24h : false,
        })),
      });

      const gear = new Map<EquipmentKey, { id: string; name: string; price: number }>();
      for (const e of EQUIPMENT) {
        const row = await this.prisma.campAddon.create({
          data: {
            tenantId: tenant.id,
            campgroundId: campground.id,
            name: e.name,
            category: e.category,
            description: e.description,
            pricePerUnit: e.price,
            unit: e.unit,
            deposit: e.deposit || null,
            stockQty: e.stock,
            active: true,
          },
        });
        gear.set(e.key, { id: row.id, name: e.name, price: e.price });
      }

      const reservationCount = await this.seedReservations(
        tenant.id,
        campground.id,
        pitchByCode,
        gear,
      );
      const linkedItems = await this.linkInventory(tenant.id, property.id, campground, gear);
      await this.seedWebsite(tenant.id, property.id, campground.id);

      this.logger.log(
        `  ✓ ${CAMP_NAME}: ${ZONES.length} zones, ${pitchByCode.size} pitches, ${FACILITIES.length} facilities, ` +
          `${EQUIPMENT.length} rental items (${linkedItems} linked to inventory), ${reservationCount} reservations, website ${SITE_SLUG}`,
      );
    } catch (error) {
      this.logger.warn(`  ⚠️ Error seeding premium camp: ${(error as Error).message}`);
    }
  }

  private async seedZonesAndPitches(
    tenantId: string,
    campgroundId: string,
  ): Promise<Map<string, { id: string; zone: ZoneSeed & { id: string } }>> {
    const pitches = new Map<string, { id: string; zone: ZoneSeed & { id: string } }>();
    const newYear = new Date().getUTCFullYear();
    for (const z of ZONES) {
      const zone = await this.prisma.campZone.create({
        data: {
          tenantId,
          campgroundId,
          name: z.name,
          code: z.code,
          type: z.type,
          description: z.description,
          basePrice: z.basePrice,
          weekendPrice: z.weekendPrice,
          // ช่วงเทศกาลปีใหม่ — ทดสอบลำดับราคา season > weekend > base
          seasonalRates: asJson([
            {
              name: 'ปีใหม่',
              start: `${newYear}-12-29`,
              end: `${newYear + 1}-01-02`,
              price: Math.round(z.basePrice * 1.6),
            },
          ]),
          maxGuests: z.maxGuests,
          maxTents: z.maxTents,
          allowVehicle: z.allowVehicle,
          allowPet: z.allowPet,
          pricingMode: z.pricingMode,
          hasElectricity: z.hasElectricity,
          electricityFee: z.electricityFee,
          allowAircon: z.allowAircon,
          maxWatt: z.maxWatt,
          restrictions: asJson(z.restrictions),
          color: z.color,
        },
      });
      for (const [i, [x, y]] of z.pitches.entries()) {
        const code = `${z.code}${i + 1}`;
        const pitch = await this.prisma.campPitch.create({
          data: {
            tenantId,
            campgroundId,
            zoneId: zone.id,
            code,
            // จุดสุดท้ายของโซน A ปิดซ่อม — ทดสอบจุดที่จองไม่ได้
            status: z.code === 'A' && i === z.pitches.length - 1 ? 'maintenance' : 'available',
            ...mapPos(x, y),
            sizeSqm: z.type === 'rv' ? 60 : z.type === 'glamping' ? 30 : 25,
          },
        });
        pitches.set(code, { id: pitch.id, zone: { ...z, id: zone.id } });
      }
    }
    return pitches;
  }

  private async seedReservations(
    tenantId: string,
    campgroundId: string,
    pitchByCode: Map<string, { id: string; zone: ZoneSeed & { id: string } }>,
    gear: Map<EquipmentKey, { id: string; name: string; price: number }>,
  ): Promise<number> {
    const seqByDay = new Map<string, number>();
    let count = 0;
    for (const r of RESERVATIONS) {
      const pitch = pitchByCode.get(r.pitch);
      if (!pitch) continue;
      const checkIn = utcDay(r.inOffset);
      const checkOut = utcDay(r.inOffset + r.nights);
      const quote = quoteCampStay(pitch.zone, checkIn, checkOut, r.guests);
      const lines = r.gear.map(([key, qty]) => ({ ...gear.get(key)!, qty }));
      const gearTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
      const total = quote.lodging + quote.electricity + gearTotal;
      const amountPaid = Math.round(total * r.paid);

      // เลขจองนับตามวันที่สร้าง (CMP-YYYYMMDD-NNNN) — สร้างย้อนหลัง 3 วันก่อนเข้าพัก หรือวันนี้
      const createdAt = utcDay(Math.min(r.inOffset - 3, 0));
      const day = ymd(createdAt);
      const seq = (seqByDay.get(day) ?? 0) + 1;
      seqByDay.set(day, seq);

      const paidAt =
        r.status === 'checked_out' || r.status === 'checked_in'
          ? atBangkok(checkIn, '13:30')
          : createdAt;
      const payments =
        amountPaid > 0
          ? [
              {
                at: paidAt.toISOString(),
                amount: amountPaid,
                method: r.method,
                ...(r.method !== 'cash' ? { reference: `REF${day}${seq}` } : {}),
                ...(r.paid < 1 ? { note: 'มัดจำ' } : {}),
              },
            ]
          : [];

      const reservation = await this.prisma.campReservation.create({
        data: {
          tenantId,
          campgroundId,
          zoneId: pitch.zone.id,
          pitchId: pitch.id,
          reservationNo: `CMP-${day}-${String(seq).padStart(4, '0')}`,
          guestFirstName: r.first,
          guestLastName: r.last,
          guestEmail: r.email,
          guestPhone: r.phone,
          checkIn,
          checkOut,
          scheduledCheckIn: atBangkok(checkIn, '13:00'),
          scheduledCheckOut: atBangkok(checkOut, '11:00'),
          actualCheckIn:
            r.status === 'checked_in' || r.status === 'checked_out'
              ? atBangkok(checkIn, '13:30')
              : null,
          actualCheckOut: r.status === 'checked_out' ? atBangkok(checkOut, '10:45') : null,
          numGuests: r.guests,
          numTents: r.tents,
          numVehicles: r.vehicles,
          hasPet: r.pet,
          status: r.status,
          totalPrice: total,
          addons: asJson(lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price }))),
          paymentStatus: amountPaid === 0 ? 'pending' : amountPaid >= total ? 'paid' : 'partial',
          paymentMethod: amountPaid > 0 ? r.method : null,
          amountPaid,
          payments: asJson(payments),
          source: r.source,
          slipUrl:
            r.source === 'WEBSITE' && r.status === 'pending'
              ? 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=600&q=60'
              : null,
          notes: r.notes ?? null,
          createdAt,
        },
      });
      if (lines.length) {
        await this.prisma.campReservationAddon.createMany({
          data: lines.map((l) => ({
            reservationId: reservation.id,
            addonId: l.id,
            name: l.name,
            qty: l.qty,
            priceSnapshot: l.price,
          })),
        });
      }
      if (r.status === 'checked_out') {
        await this.postRevenue(reservation.id, campgroundId);
      }
      if (r.status === 'checked_in') {
        await this.prisma.campPitch.update({
          where: { id: pitch.id },
          data: { status: 'occupied' },
        });
      }
      count++;
    }
    return count;
  }

  /**
   * เชื่อมลานเข้าคลังสินค้า แบบเดียวกับ CampgroundsService.connectInventory (คลังย่อย code CAMP-xxxxxxxx)
   * แล้วผูกอุปกรณ์เช่าทุกตัวกับสินค้าในคลัง:
   * - คลังลาน = จำนวนที่ลานมีทั้งหมด (ว่าง + ถูกยืม) — การเช่าไม่ตัดคลัง
   * - campAddon.stockQty = ว่างให้เช่า = ทั้งหมด − ที่ออกไปกับใบจอง active
   *   (ลานที่เชื่อมคลังแล้ว ReservationsService ตัด stockQty ตอนจอง ⇒ ยอด seed ต้องหักไว้ก่อน)
   */
  private async linkInventory(
    tenantId: string,
    propertyId: string,
    campground: { id: string; name: string; address: string | null },
    gear: Map<EquipmentKey, { id: string; name: string; price: number }>,
  ): Promise<number> {
    const code = `CAMP-${campground.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const warehouse =
      (await this.prisma.warehouse.findFirst({
        where: { tenantId, propertyId, code, deletedAt: null },
        select: { id: true },
      })) ??
      (await this.prisma.warehouse.create({
        data: {
          tenantId,
          propertyId,
          code,
          name: `คลังลาน: ${campground.name}`.slice(0, 100),
          type: WarehouseType.GENERAL,
          location: campground.address,
          isDefault: false,
          isActive: true,
        },
        select: { id: true },
      }));
    await this.prisma.campground.update({
      where: { id: campground.id },
      data: { warehouseId: warehouse.id },
    });

    const central = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'WH-MAIN', deletedAt: null },
      select: { id: true },
    });

    const out = await this.prisma.campReservationAddon.groupBy({
      by: ['addonId'],
      where: {
        addonId: { in: [...gear.values()].map((g) => g.id) },
        reservation: { status: { in: GEAR_OUT_STATUSES } },
      },
      _sum: { qty: true },
    });
    const borrowedByAddon = new Map(out.map((o) => [o.addonId, o._sum.qty ?? 0]));

    let linked = 0;
    for (const e of EQUIPMENT) {
      const addon = gear.get(e.key);
      if (!addon) continue;
      const inv = GEAR_INVENTORY[e.key];
      const borrowed = borrowedByAddon.get(addon.id) ?? 0;
      const owned = Math.max(e.stock, borrowed);
      const sku = `CAMP-GEAR-${e.key.toUpperCase()}`;

      const item = await this.prisma.inventoryItem.upsert({
        where: { tenantId_sku: { tenantId, sku } },
        create: {
          tenantId,
          sku,
          name: e.name,
          description: e.description,
          unit: inv.unit,
          reorderPoint: Math.ceil(e.stock * 0.2),
          reorderQty: Math.max(5, Math.ceil(e.stock * 0.5)),
        },
        update: { name: e.name, unit: inv.unit, deletedAt: null },
        select: { id: true },
      });

      const stocks = [
        { warehouseId: warehouse.id, quantity: owned },
        ...(central ? [{ warehouseId: central.id, quantity: inv.centralQty }] : []),
      ];
      for (const st of stocks) {
        const values = {
          quantity: st.quantity,
          avgCost: inv.cost,
          totalValue: st.quantity * inv.cost,
        };
        await this.prisma.warehouseStock.upsert({
          where: { warehouseId_itemId: { warehouseId: st.warehouseId, itemId: item.id } },
          create: { warehouseId: st.warehouseId, itemId: item.id, ...values },
          update: values,
        });
      }

      await this.prisma.campAddon.update({
        where: { id: addon.id },
        data: { inventoryItemId: item.id, stockQty: owned - borrowed },
      });
      linked++;
    }
    this.logger.log(`  ✓ ${campground.name}: เชื่อมคลัง ${code} + ผูกอุปกรณ์เช่า ${linked} รายการ`);
    return linked;
  }

  /** เช็คเอาต์แล้ว = รายได้เกิดแล้ว — ลงสมุดรายได้กลางแบบเดียวกับ ReservationsService.checkOut
   *  ไม่งั้นแดชบอร์ด/รายงานของลานขึ้นรายได้ 0 ทั้งที่มีการจองที่จ่ายครบ */
  private async postRevenue(reservationId: string, campgroundId: string): Promise<void> {
    const row = await this.prisma.campReservation.findFirst({
      where: { id: reservationId },
      select: CAMP_REVENUE_SELECT,
    });
    if (!row) return;
    const revenue = buildCampRevenueInput(row, { campgroundId, campgroundName: CAMP_NAME });
    if (hasPostableRevenue(revenue)) await this.revenuePosting.post(revenue);
  }

  private async seedWebsite(
    tenantId: string,
    propertyId: string,
    campgroundId: string,
  ): Promise<void> {
    if (
      await this.prisma.websiteSite.findFirst({
        where: { OR: [{ propertyId }, { slug: SITE_SLUG }] },
      })
    ) {
      this.logger.log('  ⊙ Premium camp website already exists');
      return;
    }
    const content = sanitizeSiteContent(
      buildDefaultContent({
        hotelName: CAMP_NAME,
        phone: CAMP_PHONE,
        email: CAMP_EMAIL,
        hasRestaurants: true,
        kind: 'camp',
      }),
      CAMP_NAME,
      'camp',
    );
    const theme = sanitizeTheme({}, 'fresh');
    const seo = sanitizeSeo(
      {
        title: { th: `${CAMP_NAME} | ลานกางเต็นท์ปากช่อง`, en: `${CAMP_NAME} | Khao Yai Camping` },
        description: {
          th: 'ลานกางเต็นท์วิวเขา ริมลำธาร รถบ้าน และแกลมปิ้ง ใกล้เขาใหญ่ จองออนไลน์ได้ทันที',
          en: 'Mountain-view, riverside, RV and glamping pitches near Khao Yai. Book online instantly.',
        },
      },
      CAMP_NAME,
    );
    await this.prisma.websiteSite.create({
      data: {
        tenantId,
        propertyId,
        campgroundId,
        slug: SITE_SLUG,
        status: 'PUBLISHED',
        templateKey: 'fresh',
        defaultLang: 'th',
        theme: asJson(theme),
        seo: asJson(seo),
        draftContent: asJson(content),
        publishedContent: asJson(content),
        publishedTheme: asJson(theme),
        publishedSeo: asJson(seo),
        publishedAt: new Date(),
      },
    });
    // บัญชีรับเงินของลานเอง (เบอร์ทดสอบ — PROMPTPAY_ID ใน env เป็นของแพลตฟอร์ม ห้ามใช้รับเงินแขก)
    if (
      !(await this.prisma.paymentAccount.findFirst({ where: { propertyId, kind: 'promptpay' } }))
    ) {
      await this.prisma.paymentAccount.create({
        data: {
          propertyId,
          kind: 'promptpay',
          label: 'PromptPay หน้าเว็บ',
          promptpayId: '0812345678',
          accountName: CAMP_NAME,
          isDefault: true,
        },
      });
    }
  }
}
