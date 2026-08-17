/**
 * พิสูจน์สมุดรายได้กับฐานข้อมูลจริง ไม่ใช่ mock
 *
 * สเปกใน src/modules/revenue/__tests__ mock Prisma ไว้ จึงไม่เคยผ่าน
 * tenant-scope middleware และไม่เคยชน unique constraint ของ MySQL เลย —
 * เทสต์เขียวหมดแต่ยิงจริงพังเป็นเรื่องที่เกิดมาแล้วในโปรเจกต์นี้ สคริปต์นี้จึงยิง
 * RevenuePostingService ตัวจริงผ่าน PrismaService ตัวจริง (middleware ครบ)
 * เข้า hotel_services_db แล้วอ่านผลกลับมาตรวจทีละข้อ
 *
 * ล้างแถวที่ตัวเองสร้างทิ้งทุกครั้งตอนจบ ไม่ทิ้งขยะไว้ในฐาน
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/verify-revenue-ledger.ts
 */
import { ConfigService } from '@nestjs/config';
import { RevenueSourceModule, RevenueType } from '@prisma/client';
import { config as loadEnv } from 'dotenv';
import { EncryptionService } from '@/common/services/encryption.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';

loadEnv();

const PREMIUM_EMAIL = 'premium.test@email.com';
/** prefix ของ sourceId ที่สคริปต์นี้สร้าง ใช้เก็บกวาดตอนจบ */
const PREFIX = 'verify-revenue-';

const YESTERDAY = new Date('2026-08-16T08:00:00.000Z'); // 15:00 ตามเวลาไทย
const TODAY = new Date('2026-08-17T08:00:00.000Z');
/** 2026-08-17T17:30Z = 18 ส.ค. 00:30 ตามเวลาไทย */
const PAST_MIDNIGHT = new Date('2026-08-17T17:30:00.000Z');

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, String(actual) === String(expected), `ได้ ${actual} คาดว่า ${expected}`);
}

async function main() {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(
    new EncryptionService(new ConfigService()),
    tenantContext,
  );
  await prisma.$connect();
  const service = new RevenuePostingService(prisma);

  const owner = await prisma.user.findFirst({
    where: { email: PREMIUM_EMAIL },
    select: { tenantId: true },
  });
  if (!owner?.tenantId) throw new Error(`ไม่พบผู้ใช้ ${PREMIUM_EMAIL}`);
  const tenantId = owner.tenantId;
  console.log(`\ntenant: ${tenantId}\n`);

  const cleanup = () =>
    prisma.revenueEntry.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  await tenantContext.runUnscoped(cleanup);

  // ทุกอย่างต่อจากนี้รันในบริบทของ tenant จริง เหมือนตอนมี request วิ่งเข้ามา
  await tenantContext.run({ tenantId, skipScope: false }, async () => {
    const base = {
      tenantId,
      propertyId: null,
      sourceModule: RevenueSourceModule.RESTAURANT,
      sourceType: 'ORDER' as const,
      outletId: 'rest-verify',
      outletName: 'ร้านทดสอบ',
      settlement: 'CASH' as const,
    };

    console.log('1) โพสต์บิลอาหาร + เครื่องดื่ม + ค่าบริการ');
    const orderId = `${PREFIX}order-1`;
    const first = await service.post({
      ...base,
      sourceId: orderId,
      documentNo: 'ORD-VERIFY-1',
      occurredAt: TODAY,
      lines: [
        { revenueType: RevenueType.FOOD, grossAmount: 300 },
        { revenueType: RevenueType.FOOD, grossAmount: 200, discount: 50 },
        { revenueType: RevenueType.BEVERAGE, grossAmount: 120 },
        { revenueType: RevenueType.SERVICE_CHARGE, grossAmount: 57 },
      ],
    });
    eq('สร้าง 3 แถว (FOOD รวมกันแล้ว)', first.created, 3);
    eq('netAmount รวม', first.netAmount, 627);
    eq('วันธุรกิจ', first.businessDate, '2026-08-17');

    const rows = await prisma.revenueEntry.findMany({
      where: { sourceId: orderId },
      orderBy: { revenueType: 'asc' },
    });
    eq('อ่านกลับมาได้ 3 แถว', rows.length, 3);
    const food = rows.find((r) => r.revenueType === 'FOOD')!;
    eq('FOOD gross รวมสองบรรทัด', Number(food.grossAmount), 500);
    eq('FOOD net หลังส่วนลด', Number(food.netAmount), 450);
    eq('FOOD ตกแผนก F&B', food.segment, 'FOOD_BEVERAGE');
    eq(
      'businessDate เก็บเป็น UTC midnight',
      food.businessDate.toISOString(),
      '2026-08-17T00:00:00.000Z',
    );
    const svc = rows.find((r) => r.revenueType === 'SERVICE_CHARGE')!;
    eq('ค่าบริการเกาะแผนก F&B', svc.segment, 'FOOD_BEVERAGE');
    eq('ยังไม่ได้ลงบัญชี (รอ Phase 4)', svc.journalEntryId, 'null');

    console.log('\n2) ยิงซ้ำใบเดิม (retry ของ POS)');
    const retry = await service.post({
      ...base,
      sourceId: orderId,
      documentNo: 'ORD-VERIFY-1',
      occurredAt: TODAY,
      lines: [
        { revenueType: RevenueType.FOOD, grossAmount: 500, discount: 50 },
        { revenueType: RevenueType.BEVERAGE, grossAmount: 120 },
        { revenueType: RevenueType.SERVICE_CHARGE, grossAmount: 57 },
      ],
    });
    eq('ไม่สร้างแถวใหม่', retry.created, 0);
    eq('ไม่มีอะไรเปลี่ยน', retry.unchanged, 3);
    const afterRetry = await prisma.revenueEntry.count({ where: { sourceId: orderId } });
    eq('จำนวนแถวเท่าเดิม', afterRetry, 3);

    console.log('\n3) บิลหลังเที่ยงคืนไทยตกวันใหม่');
    const lateId = `${PREFIX}order-late`;
    const late = await service.post({
      ...base,
      sourceId: lateId,
      occurredAt: PAST_MIDNIGHT,
      lines: [{ revenueType: RevenueType.FOOD, grossAmount: 100 }],
    });
    eq('วันธุรกิจเป็นวันที่ 18', late.businessDate, '2026-08-18');
    const lateRow = await prisma.revenueEntry.findFirst({ where: { sourceId: lateId } });
    eq(
      'แถวในฐานลงวันที่ 18',
      lateRow!.businessDate.toISOString().slice(0, 10),
      '2026-08-18',
    );

    console.log('\n4) ยกเลิกวันเดียวกับที่ขาย');
    const sameDayId = `${PREFIX}order-sameday`;
    await service.post({
      ...base,
      sourceId: sameDayId,
      occurredAt: TODAY,
      lines: [{ revenueType: RevenueType.FOOD, grossAmount: 240 }],
    });
    const sameDay = await service.void({
      tenantId,
      sourceType: 'ORDER',
      sourceId: sameDayId,
      voidedBy: 'verify-script',
      reason: 'ลูกค้ายกเลิก',
      at: TODAY,
    });
    eq('ตีตกแถวเดิม', sameDay.voided, 1);
    eq('ไม่ออกแถวกลับรายการ', sameDay.reversed, 0);
    const sameDayRows = await prisma.revenueEntry.findMany({ where: { sourceId: sameDayId } });
    eq('ยังมีแถวเดียว (ไม่ถูกลบทิ้ง)', sameDayRows.length, 1);
    eq('สถานะเป็น VOIDED', sameDayRows[0].status, 'VOIDED');

    console.log('\n5) ยกเลิกข้ามวัน');
    const crossId = `${PREFIX}order-cross`;
    await service.post({
      ...base,
      sourceId: crossId,
      occurredAt: YESTERDAY,
      lines: [{ revenueType: RevenueType.FOOD, grossAmount: 800 }],
    });
    const cross = await service.void({
      tenantId,
      sourceType: 'ORDER',
      sourceId: crossId,
      voidedBy: 'verify-script',
      at: TODAY,
    });
    eq('ออกแถวกลับรายการ', cross.reversed, 1);
    eq('ไม่ไปตีตกแถวเดิม', cross.voided, 0);

    const crossRows = await prisma.revenueEntry.findMany({
      where: { sourceId: crossId },
      orderBy: { entryKind: 'asc' },
    });
    eq('มี 2 แถว (ต้นฉบับ + แถวกลับ)', crossRows.length, 2);
    const original = crossRows.find((r) => r.entryKind === 'ORIGINAL')!;
    const reversal = crossRows.find((r) => r.entryKind === 'REVERSAL')!;
    eq('ต้นฉบับยังเป็น POSTED ของวันที่ 16', original.status, 'POSTED');
    eq(
      'ต้นฉบับยังอยู่วันเดิม',
      original.businessDate.toISOString().slice(0, 10),
      '2026-08-16',
    );
    eq(
      'แถวกลับลงวันที่ยกเลิก',
      reversal.businessDate.toISOString().slice(0, 10),
      '2026-08-17',
    );
    eq('แถวกลับติดลบ', Number(reversal.netAmount), -800);
    eq('แถวกลับชี้กลับต้นฉบับ', reversal.reversalOfId, original.id);
    eq('แถวกลับลอกมิติมาครบ', reversal.outletId, 'rest-verify');

    // ผลรวมทั้งช่วงต้องเป็นศูนย์ — นี่คือจุดสำคัญของการกลับรายการ
    const netAll = await prisma.revenueEntry.aggregate({
      where: { sourceId: crossId, status: 'POSTED' },
      _sum: { netAmount: true },
    });
    eq('รวมทั้งสองวันได้ศูนย์', Number(netAll._sum.netAmount), 0);
    // แต่ยอดของวันที่ 16 ที่ปิดวันไปแล้วต้องไม่ถูกแตะ
    const netDay16 = await prisma.revenueEntry.aggregate({
      where: {
        sourceId: crossId,
        status: 'POSTED',
        businessDate: new Date('2026-08-16T00:00:00.000Z'),
      },
      _sum: { netAmount: true },
    });
    eq('ยอดวันที่ 16 ยังเป็น 800 เหมือนตอนพิมพ์รายงาน', Number(netDay16._sum.netAmount), 800);

    console.log('\n6) ยกเลิกซ้ำ / โพสต์ทับเอกสารที่กลับรายการแล้ว');
    const again = await service.void({
      tenantId,
      sourceType: 'ORDER',
      sourceId: crossId,
      voidedBy: 'verify-script',
      at: TODAY,
    });
    eq('ยกเลิกซ้ำไม่เกิดแถวใหม่', again.reversed, 0);
    eq('รายงานว่าไม่มีอะไรเปลี่ยน', again.unchanged, 1);

    let rejected = false;
    try {
      await service.post({
        ...base,
        sourceId: crossId,
        occurredAt: TODAY,
        lines: [{ revenueType: RevenueType.FOOD, grossAmount: 800 }],
      });
    } catch {
      rejected = true;
    }
    check('โพสต์ทับเอกสารที่กลับรายการแล้ว = ถูกปฏิเสธ', rejected);
    const stillTwo = await prisma.revenueEntry.count({ where: { sourceId: crossId } });
    eq('ไม่มี side effect จากการถูกปฏิเสธ', stillTwo, 2);

    console.log('\n7) unique constraint ของ MySQL กันซ้ำจริง');
    let duplicateBlocked = false;
    try {
      await prisma.revenueEntry.create({
        data: {
          tenantId,
          businessDate: new Date('2026-08-17T00:00:00.000Z'),
          occurredAt: TODAY,
          sourceModule: 'RESTAURANT',
          segment: 'FOOD_BEVERAGE',
          revenueType: 'FOOD',
          sourceType: 'ORDER',
          sourceId: orderId,
          grossAmount: 1,
          netAmount: 1,
          totalAmount: 1,
          settlement: 'CASH',
        },
      });
    } catch {
      duplicateBlocked = true;
    }
    check('แทรกแถวซ้ำกุญแจตรง ๆ ไม่ผ่าน', duplicateBlocked);

    console.log('\n8) tenant-scope middleware คุมการอ่าน');
    const scoped = await prisma.revenueEntry.findMany({
      where: { sourceId: { startsWith: PREFIX } },
      select: { tenantId: true },
    });
    check(
      'ทุกแถวที่อ่านได้เป็นของ tenant ตัวเอง',
      scoped.length > 0 && scoped.every((r) => r.tenantId === tenantId),
    );
  });

  // อ่านนอกบริบท tenant เพื่อเช็คว่าแถวถูกประทับ tenantId ไว้จริง
  const stamped = await tenantContext.runUnscoped(() =>
    prisma.revenueEntry.findMany({
      where: { sourceId: { startsWith: PREFIX } },
      select: { tenantId: true },
    }),
  );
  check(
    'ทุกแถวถูกประทับ tenantId ไว้ในฐาน',
    stamped.length > 0 && stamped.every((r) => r.tenantId === tenantId),
  );

  const removed = await tenantContext.runUnscoped(cleanup);
  console.log(`\nเก็บกวาด ${removed.count} แถว`);
  console.log(`\nผ่าน ${passed} / ไม่ผ่าน ${failed}\n`);

  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
