/**
 * เติมตาราง user_terminal_access จากข้อมูลเดิมใน users
 *
 * ก่อนหน้านี้ "ใครเข้าระบบไหนได้" อยู่ใน users.allowedSystems (สตริง JSON) บทบาทอยู่ใน
 * users.role (ช่องเดียว) และสิทธิ์ย่อยกระจายใน metadata.permissions /
 * procurementPermissions / warehousePermissions / warehouseIds / approvalLimit
 * สคริปต์นี้แปลงทั้งหมดเป็นหนึ่งแถวต่อ (user, terminal) ให้ API /tenant-users อ่านได้ตรง ๆ
 *
 * กติกา
 *   - terminal = ทุก key ใน allowedSystems ที่ไม่ใช่ 'main' และรู้จักใน TERMINAL_REGISTRY
 *   - role     = users.role ถ้าอยู่ในรายการบทบาทของ terminal นั้น ไม่งั้นบทบาทแรกของ terminal
 *   - permissions/approvalLimit/scopeIds จากคอลัมน์เดิมของ terminal นั้น (ไม่มี = null → ใช้ default)
 *   - idempotent: แถวที่มีอยู่แล้ว (user, terminal) ข้าม ไม่เขียนทับ รันซ้ำได้
 *
 * Run:
 *   npm run users:backfill-access -- --dry-run
 *   npm run users:backfill-access -- --tenant=<id>
 */
import { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '@/common/services/encryption.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  TERMINAL_REGISTRY,
  isRoleOfTerminal,
  isTerminalKey,
  type TerminalKey,
} from '@/modules/tenant-users/terminal-registry';

loadEnv();

interface Options {
  dryRun: boolean;
  tenant: string | null;
  batch: number;
}

function parseOptions(): Options {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    dryRun: args.includes('--dry-run'),
    tenant: get('tenant') ?? null,
    batch: Math.max(50, parseInt(get('batch') ?? '500', 10) || 500),
  };
}

function parseStringArray(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

function parseMetadataPermissions(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.permissions)
      ? parsed.permissions.filter((v: unknown): v is string => typeof v === 'string')
      : null;
  } catch {
    return null;
  }
}

interface LegacyUser {
  id: string;
  tenantId: string | null;
  role: string;
  allowedSystems: string;
  metadata: string | null;
  procurementPermissions: string | null;
  warehousePermissions: string | null;
  warehouseIds: string | null;
  approvalLimit: Prisma.Decimal | null;
  createdAt: Date;
}

/** แปลงบัญชีเดิมหนึ่งบัญชีเป็นรายการแถวสิทธิ์ที่ควรมี */
export function deriveRows(user: LegacyUser): Array<{
  terminal: TerminalKey;
  role: string;
  permissions: string[] | null;
  approvalLimit: number | null;
  scopeIds: string[] | null;
}> {
  const systems = parseStringArray(user.allowedSystems) ?? [];
  const rows: ReturnType<typeof deriveRows> = [];
  for (const key of systems) {
    if (key === 'main' || !isTerminalKey(key)) continue;
    const def = TERMINAL_REGISTRY[key];
    const role = isRoleOfTerminal(key, user.role) ? user.role : def.roles[0]?.value;
    if (!role) continue;

    let permissions: string[] | null = null;
    let approvalLimit: number | null = null;
    let scopeIds: string[] | null = null;
    switch (key) {
      case 'hotel-terminal':
        permissions = parseMetadataPermissions(user.metadata);
        break;
      case 'procurement':
        permissions = parseStringArray(user.procurementPermissions);
        approvalLimit = user.approvalLimit === null ? null : Number(user.approvalLimit);
        break;
      case 'warehouse':
        permissions = parseStringArray(user.warehousePermissions);
        scopeIds = parseStringArray(user.warehouseIds);
        break;
      case 'accounting':
      case 'hr':
        // สองโมดูลนี้ยืม warehousePermissions — เชื่อได้เฉพาะเมื่อ role หลักเป็นของมัน
        permissions = isRoleOfTerminal(key, user.role)
          ? parseStringArray(user.warehousePermissions)
          : null;
        break;
      default:
        break;
    }
    rows.push({ terminal: key, role, permissions, approvalLimit, scopeIds });
  }
  return rows;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(new EncryptionService(new ConfigService()), tenantContext);
  await prisma.$connect();

  const tally = { users: 0, created: 0, existing: 0, skippedNoTerminal: 0, failed: 0 };
  const startedAt = Date.now();

  console.log(
    `\nbackfill user_terminal_access${options.dryRun ? ' (dry-run — ไม่เขียนอะไรลงฐาน)' : ''}` +
      `${options.tenant ? ` tenant=${options.tenant}` : ' (ทุก tenant)'}\n`,
  );

  await tenantContext.runUnscoped(async () => {
    let cursor: string | undefined;
    for (;;) {
      const users = (await prisma.user.findMany({
        where: {
          tenantId: options.tenant ? options.tenant : { not: null },
        },
        select: {
          id: true,
          tenantId: true,
          role: true,
          allowedSystems: true,
          metadata: true,
          procurementPermissions: true,
          warehousePermissions: true,
          warehouseIds: true,
          approvalLimit: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
        take: options.batch,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })) as LegacyUser[];
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      const ids = users.map((u) => u.id);
      const existing = await prisma.userTerminalAccess.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, terminal: true },
      });
      const existingKeys = new Set(existing.map((r) => `${r.userId}:${r.terminal}`));

      for (const user of users) {
        tally.users += 1;
        if (!user.tenantId) continue;
        const rows = deriveRows(user);
        if (rows.length === 0) {
          tally.skippedNoTerminal += 1;
          continue;
        }
        for (const row of rows) {
          if (existingKeys.has(`${user.id}:${row.terminal}`)) {
            tally.existing += 1;
            continue;
          }
          if (options.dryRun) {
            tally.created += 1;
            continue;
          }
          try {
            await prisma.userTerminalAccess.create({
              data: {
                userId: user.id,
                tenantId: user.tenantId,
                terminal: row.terminal,
                role: row.role,
                permissions: row.permissions === null ? Prisma.JsonNull : row.permissions,
                approvalLimit: row.approvalLimit === null ? null : new Prisma.Decimal(row.approvalLimit),
                scopeIds: row.scopeIds === null ? Prisma.JsonNull : row.scopeIds,
                grantedBy: null,
                grantedAt: user.createdAt,
              },
            });
            tally.created += 1;
          } catch (error) {
            tally.failed += 1;
            console.error(
              `  ✗ ${user.id} ${row.terminal}:${row.role} — ${(error as Error)?.message ?? error}`,
            );
          }
        }
      }
      console.log(`  … ${tally.users} users scanned`);
    }
  });

  console.log(
    `\nสรุป (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n` +
      `  users scanned      : ${tally.users}\n` +
      `  rows created       : ${tally.created}${options.dryRun ? ' (dry-run)' : ''}\n` +
      `  rows already there : ${tally.existing}\n` +
      `  users w/o terminal : ${tally.skippedNoTerminal}\n` +
      `  failures           : ${tally.failed}\n`,
  );

  await prisma.$disconnect();
  process.exit(tally.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\nbackfill ล้มเหลว:', error);
    process.exit(1);
  });
}
