/* eslint-disable no-console */
/**
 * ซ่อมสถานะ migration ที่ค้าง (P3009) แล้ว deploy ต่อ — ไม่ลบ/ไม่ reset ข้อมูล
 *
 * 1) migration ที่ failed: ถ้าตาราง/คอลัมน์ที่มันสร้างมีครบแล้ว → resolve --applied
 *                         ถ้ายังไม่มีเลย → resolve --rolled-back (ให้ deploy รันใหม่)
 * 2) migration ที่ยังไม่ถูกบันทึก แต่ของใน DB มีครบแล้ว (เคย db push) → resolve --applied
 * 3) มีบางส่วน (ครึ่ง ๆ กลาง ๆ) → หยุด ไม่แตะอะไร ให้คนตัดสินใจ
 * 4) prisma migrate deploy + prisma generate
 *
 * ใช้: node scripts/repair-migrations.js            (ทำจริง)
 *      node scripts/repair-migrations.js --dry-run  (ดูอย่างเดียว)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry-run');
const DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const prisma = new PrismaClient();

function objectsOf(sql) {
  const clean = sql.replace(/--[^\n]*/g, '');
  const tables = [...clean.matchAll(/CREATE TABLE\s+`([^`]+)`/gi)].map((m) => m[1]);
  const columns = [];
  for (const stmt of clean.split(';')) {
    const t = stmt.match(/ALTER TABLE\s+`([^`]+)`/i);
    if (!t) continue;
    for (const c of stmt.matchAll(/ADD COLUMN\s+`([^`]+)`/gi)) columns.push([t[1], c[1]]);
  }
  return { tables, columns };
}

async function state(name) {
  const sql = fs.readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');
  const { tables, columns } = objectsOf(sql);
  const checks = [];
  for (const t of tables) {
    const r = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      t,
    );
    checks.push({ what: `table ${t}`, ok: Number(r[0].n) > 0 });
  }
  for (const [t, c] of columns) {
    const r = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
      t,
      c,
    );
    checks.push({ what: `column ${t}.${c}`, ok: Number(r[0].n) > 0 });
  }
  const have = checks.filter((x) => x.ok).length;
  const verdict = checks.length === 0 ? 'unknown' : have === checks.length ? 'all' : have === 0 ? 'none' : 'partial';
  return { verdict, checks };
}

function run(cmd) {
  console.log(`$ ${cmd}`);
  if (!DRY) execSync(cmd, { stdio: 'inherit' });
}

(async () => {
  const onDisk = fs
    .readdirSync(DIR)
    .filter((d) => fs.existsSync(path.join(DIR, d, 'migration.sql')))
    .sort();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT migration_name, finished_at, rolled_back_at, LEFT(logs, 400) AS logs FROM _prisma_migrations',
  );
  const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const failedSet = new Set(failed);
  const pending = onDisk.filter((m) => !done.has(m) && !failedSet.has(m));

  console.log(`failed: ${failed.join(', ') || '-'}`);
  console.log(`pending: ${pending.join(', ') || '-'}`);
  for (const r of rows.filter((x) => failedSet.has(x.migration_name))) {
    console.log(`  error log of ${r.migration_name}:\n    ${String(r.logs || '').split('\n').slice(0, 4).join('\n    ')}`);
  }

  const plan = [];
  for (const m of [...failed, ...pending]) {
    const s = await state(m);
    console.log(`\n${m} → ${s.verdict}`);
    for (const c of s.checks) console.log(`   ${c.ok ? '✔' : '✘'} ${c.what}`);
    if (s.verdict === 'partial' || (s.verdict === 'unknown' && failedSet.has(m))) {
      console.error(`\n⛔ ${m} อยู่ในสถานะครึ่ง ๆ กลาง ๆ — หยุด ไม่แก้อะไร`);
      process.exit(2);
    }
    if (s.verdict === 'all') plan.push(`npx prisma migrate resolve --applied ${m}`);
    else if (failedSet.has(m)) plan.push(`npx prisma migrate resolve --rolled-back ${m}`);
  }
  await prisma.$disconnect();

  console.log('\n— ดำเนินการ —');
  for (const cmd of plan) run(cmd);
  run('npx prisma migrate deploy');
  run('npx prisma generate');
  run('npx prisma migrate status');
  console.log(DRY ? '\n(dry-run: ยังไม่ได้แก้อะไร)' : '\n✅ เสร็จ — รีสตาร์ท API ได้เลย');
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
