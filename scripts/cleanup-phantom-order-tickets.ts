/**
 * One-off cleanup for phantom restaurant bills.
 *
 * Seating a table reservation used to open a dine-in order with no items, which
 * then sat on the kitchen display as a ticket with nothing to cook and kept its
 * table OCCUPIED forever. Seating no longer opens a bill (the first real order
 * does), so every item-less open order still in the database is a leftover.
 *
 * What it does:
 *   1. Cancels every open order (not COMPLETED/CANCELLED) that has zero items.
 *   2. Releases tables left OCCUPIED with no real bill on them — AVAILABLE when
 *      no party is sitting there, untouched while a booking is still SEATED.
 *
 * Safe to run twice. Pass --dry to report without writing.
 *
 * Run: npm run cleanup:phantom-orders   (add -- --dry to preview)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry');

async function main(): Promise<void> {
  console.log(DRY_RUN ? '— DRY RUN (no writes) —\n' : '— CLEANUP —\n');

  // ── 1. Item-less open orders ────────────────────────────────────────────────
  const phantoms = await prisma.order.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      items: { none: {} },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      tableId: true,
      reservationId: true,
      tenantId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`บิลเปล่าที่ยังเปิดอยู่: ${phantoms.length} รายการ`);
  for (const p of phantoms) {
    console.log(
      `  · ${p.orderNumber} [${p.status}] table=${p.tableId ?? '-'} ` +
        `reservation=${p.reservationId ?? '-'} created=${p.createdAt.toISOString()}`,
    );
  }

  if (!DRY_RUN && phantoms.length > 0) {
    const { count } = await prisma.order.updateMany({
      where: { id: { in: phantoms.map((p) => p.id) } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    console.log(`  → ยกเลิกแล้ว ${count} บิล`);
  }

  // ── 2. Tables stuck OCCUPIED without a real bill ────────────────────────────
  const occupied = await prisma.restaurantTable.findMany({
    where: { status: 'OCCUPIED' },
    select: {
      id: true,
      tableNumber: true,
      restaurantId: true,
      orders: {
        where: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, items: { some: {} } },
        select: { id: true },
        take: 1,
      },
      reservations: {
        where: { status: 'SEATED' },
        select: { id: true },
        take: 1,
      },
    },
  });

  // A table with a live bill is genuinely in use; so is one with a party still
  // seated on it (they just have not ordered yet). Everything else is stuck.
  const stuck = occupied.filter((t) => t.orders.length === 0 && t.reservations.length === 0);

  console.log(`\nโต๊ะที่ค้าง OCCUPIED โดยไม่มีบิลจริง: ${stuck.length} โต๊ะ`);
  for (const t of stuck) {
    console.log(`  · โต๊ะ ${t.tableNumber} (${t.id})`);
  }

  if (!DRY_RUN && stuck.length > 0) {
    const { count } = await prisma.restaurantTable.updateMany({
      where: { id: { in: stuck.map((t) => t.id) } },
      data: { status: 'AVAILABLE' },
    });
    console.log(`  → คืนโต๊ะให้ว่างแล้ว ${count} โต๊ะ`);
  }

  console.log('\nเสร็จสิ้น');
}

main()
  .catch((error) => {
    console.error('cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
