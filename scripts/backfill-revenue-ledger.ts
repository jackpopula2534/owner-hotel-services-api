/**
 * เติมสมุดรายได้ย้อนหลังจากเอกสารที่ปิดไปแล้วก่อนระบบนี้จะมี
 *
 * สี่ช่องทางเริ่มลงสมุดรายได้ตอนปิดบิลตั้งแต่วันที่เดินสายเสร็จ แต่เอกสารที่ปิดไป
 * ก่อนหน้านั้นยังไม่มีแถวในสมุดเลย ถ้าเปิดให้รายงานอ่านจากสมุดทันที (Phase 3)
 * ยอดของเมื่อวานจะกลายเป็นศูนย์ทั้งแผง สคริปต์นี้คือสะพานข้ามช่วงนั้น
 *
 * ── หลักการ ──────────────────────────────────────────────────────────────────
 * ใช้ตัวแปลงเอกสารต้นทางชุดเดียวกับตอนปิดบิลจริง (`buildXxxRevenueInput`) ไม่ได้
 * เขียนสูตรใหม่ ยอดที่ backfill ได้จึงเท่ากับยอดที่ระบบจะบันทึกเองเป๊ะ — ถ้าเขียน
 * แยกสองที่ วันหนึ่งจะแก้ที่เดียวแล้วตัวเลขสองยุคจะไม่ตรงกันโดยไม่มีอะไรฟ้อง
 *
 * `post()` เป็น idempotent ตาม (tenantId, sourceType, sourceId, revenueType)
 * รันซ้ำกี่รอบก็ได้ผลเดิม รันทับช่วงที่ระบบลงเองไปแล้วก็ไม่เกิดแถวซ้ำ (จะขึ้นเป็น
 * unchanged) จึงรันแบบแบ่งช่วงวันหลาย ๆ รอบได้อย่างปลอดภัย
 *
 * ── ที่มันไม่ทำ ───────────────────────────────────────────────────────────────
 * ไม่แตะเอกสารที่ถูกยกเลิก/คืนเงิน (บิล REFUNDED, ใบเสร็จ VOIDED, การจองที่
 * cancelled) — ของพวกนั้นไม่เคยมีแถวในสมุดให้ต้องดึงกลับ การกลับรายการย้อนหลัง
 * ต้องรู้ "วันที่ยกเลิก" ซึ่งเอกสารเก่าส่วนใหญ่ไม่ได้เก็บไว้ ถ้าเดาวันแล้วออกแถว
 * ติดลบผิดวัน ยอดของวันนั้นจะเพี้ยนกว่าการไม่ทำอะไรเลย
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-revenue-ledger.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-revenue-ledger.ts \
 *     --tenant=<id> --from=2026-01-01 --to=2026-08-17 --modules=orders,retail
 *
 * Flags:
 *   --tenant=<id|all>   เฉพาะ tenant เดียว (ค่าเริ่มต้น: ทุก tenant)
 *   --from / --to       ช่วงวันธุรกิจ (YYYY-MM-DD, ตามเวลาไทย, รวมปลายทั้งสองข้าง)
 *   --modules=a,b       orders | retail | bookings | camp (ค่าเริ่มต้น: ทั้งหมด)
 *   --batch=<n>         ขนาดชุดที่อ่านต่อรอบ (ค่าเริ่มต้น 200)
 *   --dry-run           คำนวณอย่างเดียว ไม่เขียนอะไรลงฐาน
 *   --verbose           พิมพ์ทุกใบที่ประมวลผล ไม่ใช่แค่สรุป
 */
import { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { EncryptionService } from '@/common/services/encryption.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  RECOGNIZED_ORDER_PAYMENT_STATUSES,
  RECOGNIZED_STAY_STATUSES,
} from '@/common/constants/revenue-recognition.const';
import { bangkokDayRange } from '@/common/utils/bangkok-day.util';
import {
  hasPostableRevenue,
  RevenuePostingService,
  type PostRevenueInput,
} from '@/modules/revenue/revenue-posting.service';
import {
  buildOrderRevenueInput,
  ORDER_REVENUE_SELECT,
} from '@/modules/revenue/sources/order-revenue.source';
import {
  buildRetailSaleRevenueInput,
  RETAIL_SALE_REVENUE_SELECT,
} from '@/modules/revenue/sources/retail-sale-revenue.source';
import {
  buildBookingRevenueInput,
  BOOKING_REVENUE_SELECT,
} from '@/modules/revenue/sources/booking-revenue.source';
import {
  buildCampRevenueInput,
  CAMP_REVENUE_SELECT,
} from '@/modules/revenue/sources/camp-revenue.source';
import { isKnownPaymentMethod } from '@/modules/revenue/sources/settlement.util';

loadEnv();

// ─── Options ──────────────────────────────────────────────────────────────────

type ModuleKey = 'orders' | 'retail' | 'bookings' | 'camp';
const ALL_MODULES: ModuleKey[] = ['orders', 'retail', 'bookings', 'camp'];

interface Options {
  tenant: string | null;
  /** ขอบล่างแบบรวม (>=) */
  from: Date | null;
  /** ขอบบนแบบไม่รวม (<) — เที่ยงคืนของวันถัดจาก --to ตามเวลาไทย */
  toExclusive: Date | null;
  fromLabel: string;
  toLabel: string;
  modules: ModuleKey[];
  batch: number;
  dryRun: boolean;
  verbose: boolean;
}

const flag = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const has = (name: string): boolean => process.argv.includes(`--${name}`);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * วันในธงเป็นวันตามปฏิทินไทย — ขอบหน้าต่างจึงต้องแปลงเป็น UTC ให้ตรงวันไทย
 *
 * `--to=2026-08-17` หมายถึง "ถึงสิ้นวันที่ 17 ตามเวลาไทย" จึงคืนขอบบนเป็นเที่ยงคืน
 * ของวันถัดไปแล้วเทียบด้วย `lt` — ถ้าใช้ `lte` กับเที่ยงคืนวันเดียวกัน เอกสารทั้งวัน
 * ที่ 17 จะหลุดออกจากช่วงไปเงียบ ๆ
 */
function parseDay(value: string | undefined, edge: 'start' | 'end'): Date | null {
  if (!value) return null;
  if (!DAY_PATTERN.test(value)) throw new Error(`วันที่ต้องเป็นรูปแบบ YYYY-MM-DD: ${value}`);
  const range = bangkokDayRange(value);
  if (Number.isNaN(range.start.getTime())) throw new Error(`วันที่ไม่ถูกต้อง: ${value}`);
  return edge === 'start' ? range.start : range.end;
}

function parseOptions(): Options {
  const modules = (flag('modules') ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean) as ModuleKey[];

  for (const module of modules) {
    if (!ALL_MODULES.includes(module)) {
      throw new Error(`--modules ไม่รู้จัก "${module}" (มีให้เลือก: ${ALL_MODULES.join(', ')})`);
    }
  }

  const tenant = flag('tenant');
  const batch = Number(flag('batch') ?? 200);
  if (!Number.isFinite(batch) || batch < 1) throw new Error('--batch ต้องเป็นจำนวนเต็มบวก');

  return {
    tenant: !tenant || tenant === 'all' ? null : tenant,
    from: parseDay(flag('from'), 'start'),
    toExclusive: parseDay(flag('to'), 'end'),
    fromLabel: flag('from') ?? 'ตั้งแต่แรก',
    toLabel: flag('to') ?? 'ถึงปัจจุบัน',
    modules: modules.length ? modules : ALL_MODULES,
    batch,
    dryRun: has('dry-run'),
    verbose: has('verbose'),
  };
}

// ─── Tally ────────────────────────────────────────────────────────────────────

class Tally {
  documents = 0;
  created = 0;
  updated = 0;
  unchanged = 0;
  /** เอกสารที่ยอดเป็นศูนย์โดยชอบ — ข้ามไป ไม่ใช่ความผิดพลาด */
  skippedZero = 0;
  netAmount = 0;
  /** ใบที่ช่องทางชำระแปลไม่ออก แล้วตกเป็น CASH แบบเดา */
  guessedSettlement = 0;
  readonly guessedSamples = new Set<string>();
  readonly failures: { sourceId: string; message: string }[] = [];

  posted(result: { created: number; updated: number; unchanged: number; netAmount: number }) {
    this.created += result.created;
    this.updated += result.updated;
    this.unchanged += result.unchanged;
    this.netAmount = round2(this.netAmount + result.netAmount);
  }

  guessed(method: string | null | undefined) {
    this.guessedSettlement += 1;
    if (this.guessedSamples.size < 5) this.guessedSamples.add(String(method ?? '(ว่าง)'));
  }

  get touched(): boolean {
    return this.documents > 0 || this.failures.length > 0;
  }
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const baht = (value: number): string =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Runner ───────────────────────────────────────────────────────────────────

interface Ctx {
  prisma: PrismaService;
  poster: RevenuePostingService;
  options: Options;
}

/**
 * โพสต์เอกสารหนึ่งใบ (หรือแค่คำนวณถ้า --dry-run)
 *
 * ใบที่ล้มไม่หยุดทั้งชุด — เก็บเหตุผลไว้รายงานตอนท้ายแล้วเดินต่อ เอกสารที่พังใบ
 * เดียวไม่ควรทำให้ยอดของทั้ง tenant ค้างครึ่งทาง
 */
async function postOne(
  ctx: Ctx,
  tally: Tally,
  input: PostRevenueInput,
  label: string,
  paymentMethod: string | null | undefined,
): Promise<void> {
  tally.documents += 1;
  if (!isKnownPaymentMethod(paymentMethod)) tally.guessed(paymentMethod);

  if (!hasPostableRevenue(input)) {
    tally.skippedZero += 1;
    if (ctx.options.verbose) console.log(`    · ${label} — ยอดศูนย์ ข้าม`);
    return;
  }

  if (ctx.options.dryRun) {
    const net = round2(
      input.lines.reduce(
        (sum, line) => sum + round2((line.grossAmount ?? 0) - (line.discount ?? 0)),
        0,
      ),
    );
    tally.netAmount = round2(tally.netAmount + net);
    if (ctx.options.verbose) console.log(`    · ${label} — จะลง ${baht(net)}`);
    return;
  }

  try {
    const result = await ctx.poster.post(input);
    tally.posted(result);
    if (ctx.options.verbose) {
      console.log(
        `    · ${label} — ${baht(result.netAmount)} (+${result.created}/~${result.updated}/=${result.unchanged})`,
      );
    }
  } catch (error) {
    tally.failures.push({
      sourceId: input.sourceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** อ่านทีละชุดด้วย cursor เรียงตาม id — ตารางประวัติมีได้เป็นแสนแถว */
async function eachBatch<T extends { id: string }>(
  batchSize: number,
  fetch: (cursor: string | null, take: number) => Promise<T[]>,
  handle: (rows: T[]) => Promise<void>,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const rows: T[] = await fetch(cursor, batchSize);
    if (rows.length === 0) return;
    await handle(rows);
    if (rows.length < batchSize) return;
    cursor = rows[rows.length - 1].id;
  }
}

const hasWindow = (options: Options): boolean => Boolean(options.from || options.toExclusive);

const inRange = (options: Options, field: string) => {
  if (!hasWindow(options)) return {};
  return {
    [field]: {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.toExclusive ? { lt: options.toExclusive } : {}),
    },
  };
};

const afterCursor = (cursor: string | null) => (cursor ? { id: { gt: cursor } } : {});

// ─── ช่องทางที่ 1: บิลร้านอาหาร ────────────────────────────────────────────────

async function backfillOrders(ctx: Ctx, tenantId: string): Promise<Tally> {
  const tally = new Tally();
  const { prisma, options } = ctx;

  const restaurants = await prisma.restaurant.findMany({
    where: { tenantId },
    select: { id: true, name: true, propertyId: true },
  });
  const outletById = new Map(restaurants.map((r) => [r.id, r]));

  await eachBatch(
    options.batch,
    (cursor, take) =>
      prisma.order.findMany({
        where: {
          tenantId,
          paymentStatus: { in: RECOGNIZED_ORDER_PAYMENT_STATUSES },
          // บิลที่ปิดแล้วใช้เวลาปิดเป็นวันธุรกิจ ใบที่ไม่มี completedAt (ข้อมูลเก่า)
          // ตกไปใช้ createdAt เหมือนตอนโพสต์จริง จึงกรองด้วยสองคอลัมน์
          ...(hasWindow(options)
            ? {
                OR: [
                  inRange(options, 'completedAt'),
                  { completedAt: null, ...inRange(options, 'createdAt') },
                ],
              }
            : {}),
          ...afterCursor(cursor),
        },
        select: ORDER_REVENUE_SELECT,
        orderBy: { id: 'asc' },
        take,
      }),
    async (rows) => {
      for (const row of rows) {
        const outlet = outletById.get(row.restaurantId);
        const input = buildOrderRevenueInput(row, {
          restaurantId: row.restaurantId,
          restaurantName: outlet?.name ?? null,
          propertyId: outlet?.propertyId ?? null,
        });
        await postOne(ctx, tally, input, `บิล ${row.orderNumber}`, row.paymentMethod);
      }
    },
  );

  return tally;
}

// ─── ช่องทางที่ 2: ใบเสร็จร้านค้า ──────────────────────────────────────────────

async function backfillRetail(ctx: Ctx, tenantId: string): Promise<Tally> {
  const tally = new Tally();
  const { prisma, options } = ctx;

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId },
    select: { id: true, name: true, propertyId: true },
  });
  const outletById = new Map(warehouses.map((w) => [w.id, w]));

  await eachBatch(
    options.batch,
    (cursor, take) =>
      prisma.retailSale.findMany({
        where: {
          tenantId,
          status: 'COMPLETED',
          ...inRange(options, 'soldAt'),
          ...afterCursor(cursor),
        },
        select: RETAIL_SALE_REVENUE_SELECT,
        orderBy: { id: 'asc' },
        take,
      }),
    async (rows) => {
      for (const row of rows) {
        const outlet = outletById.get(row.warehouseId);
        const input = buildRetailSaleRevenueInput(row, {
          warehouseId: row.warehouseId,
          warehouseName: outlet?.name ?? null,
          propertyId: outlet?.propertyId ?? null,
        });
        await postOne(ctx, tally, input, `ใบเสร็จ ${row.receiptNo}`, row.paymentMethod);
      }
    },
  );

  return tally;
}

// ─── ช่องทางที่ 3: การจองห้องพักที่เช็คเอาต์แล้ว ─────────────────────────────────

async function backfillBookings(ctx: Ctx, tenantId: string): Promise<Tally> {
  const tally = new Tally();
  const { prisma, options } = ctx;

  await eachBatch(
    options.batch,
    (cursor, take) =>
      prisma.booking.findMany({
        where: {
          tenantId,
          status: { in: RECOGNIZED_STAY_STATUSES },
          ...(hasWindow(options)
            ? {
                OR: [
                  inRange(options, 'actualCheckOut'),
                  { actualCheckOut: null, ...inRange(options, 'checkOut') },
                ],
              }
            : {}),
          ...afterCursor(cursor),
        },
        select: BOOKING_REVENUE_SELECT,
        orderBy: { id: 'asc' },
        take,
      }),
    async (rows) => {
      // รายการเพิ่มเติมบนใบแจ้งหนี้ของทั้งชุดในคิวรีเดียว — ใบละคิวรีคือ N+1 ที่
      // ทำให้ backfill ของโรงแรมที่มีหมื่นการจองใช้เวลาเป็นชั่วโมง
      const extrasByBooking = await sumInvoiceExtras(
        prisma,
        tenantId,
        rows.map((row) => row.id),
      );

      for (const row of rows) {
        const input = buildBookingRevenueInput(row, extrasByBooking.get(row.id) ?? 0);
        await postOne(ctx, tally, input, `การจอง ${row.bookingNo ?? row.id}`, row.paymentMethod);
      }
    },
  );

  return tally;
}

/**
 * ยอดรายการเพิ่มเติมบนใบแจ้งหนี้ ต่อการจอง
 *
 * ใช้ใบแรกของแต่ละการจองให้ตรงกับ `BookingsService.sumInvoiceExtras` ที่ใช้
 * `findFirst` ตอนเช็คเอาต์ — ถ้าตรงนี้รวมทุกใบ ยอด backfill จะมากกว่ายอดที่ระบบ
 * บันทึกเองสำหรับการจองที่มีใบแจ้งหนี้หลายใบ (ออกใหม่หลังแก้ไข)
 */
async function sumInvoiceExtras(
  prisma: PrismaService,
  tenantId: string,
  bookingIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (bookingIds.length === 0) return totals;

  const invoices = await prisma.invoices.findMany({
    where: { tenant_id: tenantId, booking_id: { in: bookingIds } },
    select: {
      booking_id: true,
      created_at: true,
      invoice_items: { select: { amount: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  for (const invoice of invoices) {
    if (!invoice.booking_id || totals.has(invoice.booking_id)) continue;
    totals.set(
      invoice.booking_id,
      invoice.invoice_items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    );
  }
  return totals;
}

// ─── ช่องทางที่ 4: การจองลานกางเต็นท์ที่เช็คเอาต์แล้ว ─────────────────────────────

async function backfillCamp(ctx: Ctx, tenantId: string): Promise<Tally> {
  const tally = new Tally();
  const { prisma, options } = ctx;

  const campgrounds = await prisma.campground.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
  const outletById = new Map(campgrounds.map((c) => [c.id, c]));

  await eachBatch(
    options.batch,
    (cursor, take) =>
      prisma.campReservation.findMany({
        where: {
          tenantId,
          status: { in: RECOGNIZED_STAY_STATUSES },
          ...(hasWindow(options)
            ? {
                OR: [
                  inRange(options, 'actualCheckOut'),
                  { actualCheckOut: null, ...inRange(options, 'checkOut') },
                ],
              }
            : {}),
          ...afterCursor(cursor),
        },
        select: CAMP_REVENUE_SELECT,
        orderBy: { id: 'asc' },
        take,
      }),
    async (rows) => {
      for (const row of rows) {
        const input = buildCampRevenueInput(row, {
          campgroundId: row.campgroundId,
          campgroundName: outletById.get(row.campgroundId)?.name ?? null,
        });
        await postOne(
          ctx,
          tally,
          input,
          `จองลาน ${row.reservationNo ?? row.id}`,
          row.paymentMethod,
        );
      }
    },
  );

  return tally;
}

const RUNNERS: Record<ModuleKey, (ctx: Ctx, tenantId: string) => Promise<Tally>> = {
  orders: backfillOrders,
  retail: backfillRetail,
  bookings: backfillBookings,
  camp: backfillCamp,
};

const MODULE_LABEL: Record<ModuleKey, string> = {
  orders: 'บิลร้านอาหาร',
  retail: 'ใบเสร็จร้านค้า',
  bookings: 'การจองห้องพัก',
  camp: 'การจองลานกางเต็นท์',
};

// ─── Main ─────────────────────────────────────────────────────────────────────

function printTally(label: string, tally: Tally, dryRun: boolean): void {
  const parts = dryRun
    ? [`${tally.documents} ใบ`, `จะลง ${baht(tally.netAmount)}`]
    : [
        `${tally.documents} ใบ`,
        `ใหม่ ${tally.created}`,
        `แก้ ${tally.updated}`,
        `เดิม ${tally.unchanged}`,
        `รวม ${baht(tally.netAmount)}`,
      ];
  if (tally.skippedZero) parts.push(`ยอดศูนย์ ${tally.skippedZero}`);
  if (tally.failures.length) parts.push(`ล้ม ${tally.failures.length}`);
  console.log(`    ${label.padEnd(22)} ${parts.join(' | ')}`);

  if (tally.guessedSettlement) {
    console.log(
      `      ⚠️  ช่องทางชำระแปลไม่ออก ${tally.guessedSettlement} ใบ (ตกเป็นเงินสด): ` +
        `${[...tally.guessedSamples].join(', ')}`,
    );
  }
  for (const failure of tally.failures.slice(0, 5)) {
    console.log(`      ❌ ${failure.sourceId}: ${failure.message}`);
  }
  if (tally.failures.length > 5) {
    console.log(`      … อีก ${tally.failures.length - 5} ใบ`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(new EncryptionService(new ConfigService()), tenantContext);
  await prisma.$connect();

  const ctx: Ctx = { prisma, poster: new RevenuePostingService(prisma), options };
  const startedAt = Date.now();

  const tenants = await tenantContext.runUnscoped(() =>
    prisma.tenants.findMany({
      where: options.tenant ? { id: options.tenant } : {},
      select: { id: true, name: true },
      orderBy: { created_at: 'asc' },
    }),
  );
  if (tenants.length === 0) throw new Error('ไม่พบ tenant ที่ตรงเงื่อนไข');

  console.log(
    `\nเติมสมุดรายได้ย้อนหลัง${options.dryRun ? ' (dry-run — ไม่เขียนอะไรลงฐาน)' : ''}\n` +
      `  tenants : ${tenants.length}\n` +
      `  ช่วงวัน : ${options.fromLabel} → ${options.toLabel} (เวลาไทย)\n` +
      `  ช่องทาง : ${options.modules.map((m) => MODULE_LABEL[m]).join(', ')}\n`,
  );

  const grand = new Tally();

  for (const tenant of tenants) {
    const perModule: [ModuleKey, Tally][] = [];

    // ทุกคิวรีวิ่งในบริบทของ tenant จริง — middleware กรอง tenant ให้เหมือนตอนมี
    // request วิ่งเข้ามา ไม่ได้อาศัยเงื่อนไข where ที่เขียนเองอย่างเดียว
    await tenantContext.run({ tenantId: tenant.id, skipScope: false }, async () => {
      for (const module of options.modules) {
        perModule.push([module, await RUNNERS[module](ctx, tenant.id)]);
      }
    });

    const touched = perModule.filter(([, tally]) => tally.touched);
    if (touched.length === 0) continue;

    console.log(`  ${tenant.name ?? tenant.id} (${tenant.id})`);
    for (const [module, tally] of touched) {
      printTally(MODULE_LABEL[module], tally, options.dryRun);
      grand.documents += tally.documents;
      grand.created += tally.created;
      grand.updated += tally.updated;
      grand.unchanged += tally.unchanged;
      grand.skippedZero += tally.skippedZero;
      grand.guessedSettlement += tally.guessedSettlement;
      grand.netAmount = round2(grand.netAmount + tally.netAmount);
      grand.failures.push(...tally.failures);
    }
    console.log('');
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('─'.repeat(72));
  console.log(
    `รวมทั้งหมด: ${grand.documents} ใบ | ` +
      (options.dryRun
        ? `จะลง ${baht(grand.netAmount)}`
        : `ใหม่ ${grand.created} | แก้ ${grand.updated} | เดิม ${grand.unchanged} | รวม ${baht(grand.netAmount)}`) +
      ` | ยอดศูนย์ ${grand.skippedZero} | ล้ม ${grand.failures.length} | ${seconds}s`,
  );
  if (grand.guessedSettlement) {
    console.log(
      `⚠️  ช่องทางชำระที่ต้องเดา ${grand.guessedSettlement} ใบ — ตรวจว่าคอลัมน์ paymentMethod ` +
        'ของข้อมูลเก่าใช้คำที่ settlement.util รู้จักหรือยัง',
    );
  }
  if (options.dryRun) console.log('dry-run: ยังไม่มีอะไรถูกเขียนลงฐาน');

  await prisma.$disconnect();
  process.exit(grand.failures.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('\nbackfill ล้มเหลว:', error);
  process.exit(1);
});
