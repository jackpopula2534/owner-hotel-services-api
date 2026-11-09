/**
 * พิสูจน์ช่องทางลานกางเต็นท์กับฐานข้อมูลจริง
 *
 * อีกสามช่องทาง (บิลร้านอาหาร ใบเสร็จร้านค้า การจองห้องพัก) ยิงผ่าน HTTP จริงได้
 * เพราะ tenant ที่ seeder สร้างเป็นสายโรงแรมทั้งหมด แต่ `camp/*` ต้องการ add-on
 * `CAMP_MODULE` ซึ่งเป็นคนละสายธุรกิจ — เรียกด้วย token ของโรงแรมจะโดน
 * `CAMP_MODULE_WRONG_PRODUCT_LINE` ตั้งแต่ guard และไม่มี tenant สายลานในชุด seed
 *
 * สคริปต์นี้จึงเรียก `ReservationsService.checkOut` ตัวจริงผ่าน `PrismaService`
 * ตัวจริง (middleware กรอง tenant ครบ, ทรานแซกชันจริง, unique constraint จริง)
 * ข้ามแค่ชั้น HTTP guard เท่านั้น — ซึ่งเป็นชั้นที่ไม่เกี่ยวกับการลงสมุดรายได้
 *
 * สร้างลาน/แปลง/การจองชั่วคราวขึ้นมาเอง แล้วลบทิ้งทั้งหมดตอนจบ ไม่ทิ้งขยะไว้ในฐาน
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/verify-camp-revenue.ts
 */
import { ConfigService } from '@nestjs/config';
import { RevenueType } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { EncryptionService } from '@/common/services/encryption.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { ReservationsService } from '@/modules/camp/reservations.service';

loadEnv();

const PREMIUM_EMAIL = 'premium.test@email.com';
/** prefix ของข้อมูลที่สคริปต์นี้สร้าง ใช้เก็บกวาดตอนจบ */
const PREFIX = 'verify-camp-';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, String(actual) === String(expected), `ได้ ${actual} คาดว่า ${expected}`);
}

async function main(): Promise<void> {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(new EncryptionService(new ConfigService()), tenantContext);
  await prisma.$connect();

  // CampAccountingService ไม่ถูกเรียกจากเส้นทางเช็คเอาต์ ส่ง stub เข้าไปแทนการ
  // ประกอบทั้ง Nest module ขึ้นมาเพียงเพื่อ dependency ที่ไม่ได้ใช้
  const reservations = new ReservationsService(
    prisma,
    {} as never,
    new RevenuePostingService(prisma),
  );

  const owner = await prisma.user.findFirst({
    where: { email: PREMIUM_EMAIL },
    select: { tenantId: true },
  });
  if (!owner?.tenantId) throw new Error(`ไม่พบผู้ใช้ ${PREMIUM_EMAIL}`);
  const tenantId = owner.tenantId;
  console.log(`\ntenant: ${tenantId}\n`);

  const groundId = `${PREFIX}ground`;
  const zoneId = `${PREFIX}zone`;
  const pitchId = `${PREFIX}pitch`;
  const addonId = `${PREFIX}catalog-addon`;
  const reservationId = `${PREFIX}res`;

  const cleanup = async (): Promise<void> => {
    await prisma.revenueEntry.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
    await prisma.campReservationAddon.deleteMany({
      where: { reservationId: { startsWith: PREFIX } },
    });
    await prisma.campReservation.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.campAddon.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.campPitch.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.campZone.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.campground.deleteMany({ where: { id: { startsWith: PREFIX } } });
  };
  await tenantContext.runUnscoped(cleanup);

  try {
    await tenantContext.run({ tenantId, skipScope: false }, async () => {
      await prisma.campground.create({
        data: { id: groundId, tenantId, name: 'ลานทดสอบสมุดรายได้' },
      });
      await prisma.campZone.create({
        data: { id: zoneId, tenantId, campgroundId: groundId, name: 'โซน A', basePrice: 800 },
      });
      await prisma.campPitch.create({
        data: { id: pitchId, tenantId, campgroundId: groundId, zoneId, code: 'A-01' },
      });
      await prisma.campAddon.create({
        data: {
          id: addonId,
          tenantId,
          campgroundId: groundId,
          name: 'เต็นท์ 3 คน',
          category: 'tent',
          pricePerUnit: 350,
          unit: 'หลัง',
        },
      });

      // ค่าที่พัก 1,600 (2 คืน) + ค่าเช่าเต็นท์ 2 หลัง หลังละ 350 = 2,300
      await prisma.campReservation.create({
        data: {
          id: reservationId,
          tenantId,
          campgroundId: groundId,
          pitchId,
          reservationNo: 'CR-VERIFY-001',
          guestFirstName: 'ผู้ทดสอบ',
          guestLastName: 'สมุดรายได้',
          checkIn: new Date('2026-08-15T07:00:00.000Z'),
          checkOut: new Date('2026-08-17T05:00:00.000Z'),
          status: 'checked_in',
          paymentMethod: 'cash',
          totalPrice: 2300,
          addonItems: {
            create: [
              { id: `${PREFIX}addon`, addonId, name: 'เต็นท์ 3 คน', qty: 2, priceSnapshot: 350 },
            ],
          },
        },
      });

      await reservations.checkOut(reservationId, tenantId);

      const entries = await prisma.revenueEntry.findMany({
        where: { sourceId: reservationId },
        orderBy: { revenueType: 'asc' },
      });

      eq('ลงสมุด 2 บรรทัด (ค่าที่พัก + ค่าเช่าอุปกรณ์)', entries.length, 2);

      const room = entries.find((e) => e.revenueType === RevenueType.ROOM);
      const other = entries.find((e) => e.revenueType === RevenueType.OTHER);

      check('มีบรรทัดค่าที่พัก (ROOM)', Boolean(room));
      check('มีบรรทัดค่าเช่าอุปกรณ์ (OTHER)', Boolean(other));
      eq('ค่าที่พัก = ราคารวม − ค่าอุปกรณ์', room?.netAmount?.toString(), '1600');
      eq('ค่าเช่าอุปกรณ์ = 2 × 350', other?.netAmount?.toString(), '700');
      eq('ค่าที่พักลง segment ROOMS', room?.segment, 'ROOMS');
      eq('ค่าเช่าอุปกรณ์ลง segment OTHER_OPERATED', other?.segment, 'OTHER_OPERATED');
      eq('sourceModule = CAMP', room?.sourceModule, 'CAMP');
      eq('ผูกกับลาน (outletId)', room?.outletId, groundId);
      eq('ชื่อลานติดไปด้วย', room?.outletName, 'ลานทดสอบสมุดรายได้');
      eq('ช่องทางชำระ = เงินสด', room?.settlement, 'CASH');
      // เช็คเอาต์จริงเกิด "วันนี้" — วันธุรกิจต้องเป็นวันที่กดปุ่ม ไม่ใช่วันออกตามกำหนด
      eq(
        'วันธุรกิจ = วันที่เช็คเอาต์จริง',
        room?.businessDate?.toISOString().slice(0, 10),
        new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10),
      );
      eq('รวมทั้งใบ = ราคารวมของการจอง', Number(room?.netAmount) + Number(other?.netAmount), 2300);

      // เช็คเอาต์ซ้ำต้องไม่เกิดแถวใหม่ — สมุดเป็น idempotent ตามเอกสารต้นทาง
      await reservations.checkOut(reservationId, tenantId);
      const afterRepeat = await prisma.revenueEntry.count({ where: { sourceId: reservationId } });
      eq('เช็คเอาต์ซ้ำไม่เพิ่มแถว', afterRepeat, 2);

      // ยกเลิกวันเดียวกับที่ลงรายได้ → ตีเป็นโมฆะ ไม่ออกแถวติดลบ
      await reservations.cancel(reservationId, tenantId);
      const voided = await prisma.revenueEntry.findMany({ where: { sourceId: reservationId } });
      check(
        'ยกเลิกวันเดียวกัน → ทุกแถวเป็น VOIDED',
        voided.length === 2 && voided.every((e) => e.status === 'VOIDED'),
        voided.map((e) => e.status).join(','),
      );
      check(
        'ไม่มีแถวกลับรายการเพิ่ม (REVERSAL)',
        voided.every((e) => e.entryKind === 'ORIGINAL'),
      );
    });
  } finally {
    await tenantContext.runUnscoped(cleanup);
  }

  console.log(`\nผ่าน ${passed} ข้อ ล้ม ${failed} ข้อ\n`);
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error('\nverify ล้มเหลว:', error);
  process.exit(1);
});
