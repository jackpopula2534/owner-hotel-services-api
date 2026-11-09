/**
 * ถอดสิทธิ์ `main` (Owner Console) ที่ค้างอยู่กับพนักงานหน้างาน — แก้ข้อมูลจากบั๊ก 2026-11-09
 *
 * เดิม `writeGrants()` ไม่เคยถอด `main` ออก บัญชีที่เคยถือบทบาทหัวหน้าแล้วถูกลดเหลือ
 * พนักงานหน้างาน (เช่น POS·waiter) จึงยังล็อกอิน Owner Console ได้
 *
 * กติกา (ตรงกับ computeAllowedSystems ใน terminal-registry.ts)
 *   - ดูเฉพาะบัญชีที่มีแถวใน user_terminal_access (จัดการผ่านหน้า "ผู้ใช้ & สิทธิ์" แล้ว)
 *   - ถ้า allowedSystems มี 'main' แต่ computeAllowedSystems(role, grants) ไม่มี → ถอด 'main'
 *   - แตะเฉพาะ 'main' เท่านั้น terminal อื่นใน allowedSystems คงเดิม
 *   - ไม่แตะบัญชีเจ้าของ/ผู้ดูแล (tenant_admin / admin / platform_admin)
 *   - idempotent รันซ้ำได้
 *
 * Run (ค่าเริ่มต้นคือ dry-run ไม่เขียนอะไร):
 *   npm run users:fix-stale-main
 *   npm run users:fix-stale-main -- --apply
 *   npm run users:fix-stale-main -- --apply --tenant=<id>
 */
import { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { EncryptionService } from '@/common/services/encryption.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { PrismaService } from '@/prisma/prisma.service';
import { stripStaleMain } from '@/modules/tenant-users/stale-main';

loadEnv();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const tenant = args.find((a) => a.startsWith('--tenant='))?.split('=')[1] ?? null;

  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(new EncryptionService(new ConfigService()), tenantContext);
  await prisma.$connect();

  console.log(
    `\nfix stale "main" access${apply ? '' : ' (dry-run — เพิ่ม --apply เพื่อเขียนจริง)'}` +
      `${tenant ? ` tenant=${tenant}` : ' (ทุก tenant)'}\n`,
  );

  let scanned = 0;
  let fixed = 0;
  await tenantContext.runUnscoped(async () => {
    const users = await prisma.user.findMany({
      where: {
        tenantId: tenant ? tenant : { not: null },
        allowedSystems: { contains: '"main"' },
      },
      select: { id: true, email: true, role: true, allowedSystems: true },
    });
    for (const u of users) {
      scanned++;
      const rows = await prisma.userTerminalAccess.findMany({
        where: { userId: u.id, revokedAt: null },
        select: { terminal: true, role: true },
      });
      const next = stripStaleMain({ ...u, grants: rows });
      if (!next) continue;
      fixed++;
      console.log(
        `  ${apply ? 'FIX ' : 'WOULD FIX'}  ${u.email}  role=${u.role}  ${u.allowedSystems} → ${JSON.stringify(next)}`,
      );
      if (apply) {
        await prisma.user.update({
          where: { id: u.id },
          data: { allowedSystems: JSON.stringify(next) },
        });
      }
    }
  });

  console.log(`\nscanned=${scanned} ${apply ? 'fixed' : 'would-fix'}=${fixed}\n`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
