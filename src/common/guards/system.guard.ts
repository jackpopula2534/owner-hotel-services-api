import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_SYSTEMS_KEY, SystemContext } from '../decorators/allow-systems.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * SystemGuard — จำกัดว่า token ที่ออกจาก "ระบบย่อย" เรียก endpoint ไหนได้บ้าง
 *
 * `auth.service.generateTokens()` ฝัง `systemContext` ลง JWT ตามประตูที่ login เข้ามา
 * (`/auth/pos/login` → `'pos'`, `/auth/hr/login` → `'hr'`, ...) และ `allowedSystems`
 * ใน DB ก็ถูกเช็คตอน login ว่า **ล็อกอินเข้าระบบไหนได้** — แต่หลังจากนั้นไม่มีใคร
 * บังคับใช้ต่อ token ของ POS จึงยิง endpoint ฝั่ง dashboard ได้ทุกอันเท่าที่ role ผ่าน
 *
 * ภัยจริง: เครื่อง POS คือ tablet วางหน้าร้าน `manager`/`tenant_admin` มี
 * `allowedSystems = ["main","pos"]` จึงล็อกอินที่เครื่องนั้นได้ ใครหยิบ token จาก
 * เครื่องไปก็คุมทั้ง tenant ได้ — bookings, payroll, users
 *
 * ## ทิศทางของกฎ
 * - `main` = superset ผ่านทุก endpoint (dashboard เรียกได้ทุกอย่างอยู่แล้ว)
 * - ระบบย่อยที่อยู่ใน `ENFORCED_SYSTEMS` = **default deny** เข้าได้เฉพาะ endpoint
 *   ที่ติด `@AllowSystems(...)` และเอ่ยชื่อระบบนั้น
 * - ระบบย่อยที่ยังไม่อยู่ใน `ENFORCED_SYSTEMS` = ปล่อยผ่านเหมือนเดิม (ดูหมายเหตุ)
 *
 * ## ทำไมต้องถอด token เอง แทนที่จะอ่าน `request.user`
 * guard ตัวนี้ลงทะเบียนเป็น **global** (`APP_GUARD`) และ Nest รัน global guard
 * **ก่อน** guard ระดับ controller เสมอ ตอนนั้น `JwtAuthGuard` ยังไม่รัน
 * `request.user` จึงยังเป็น `undefined` (`TenantGuard` เจอปัญหาเดียวกันและ
 * อธิบายไว้ในไฟล์ของมัน) ถ้ารออ่าน `request.user` guard นี้จะกลายเป็น no-op
 * ซึ่งเป็นสภาพเดิมของมันพอดี — และซ้ำร้าย `JwtStrategy.validate()` ก็ไม่เคย
 * คืน `systemContext` ออกมาด้วย
 *
 * guard นี้ **ไม่ทำหน้าที่ authenticate** token เสีย/หมดอายุ/ไม่มี → ปล่อยผ่านให้
 * `JwtAuthGuard` ที่รันทีหลังตอบ 401 เอง หน้าที่เดียวของมันคือ "token นี้มาจาก
 * ระบบไหน และระบบนั้นแตะ endpoint นี้ได้ไหม"
 */

/**
 * ระบบที่บังคับใช้จริงตอนนี้
 *
 * เริ่มที่ `pos` อย่างเดียวโดยตั้งใจ เพราะ POS คือเครื่องสาธารณะหน้าร้าน = พื้นผิว
 * ที่โดนจริง และเป็นระบบเดียวที่ไล่ endpoint ที่มันเรียกได้ครบจากหน้า frontend
 * (`app/pos/**`) การเปิด `procurement`/`warehouse`/`hr`/`accounting`/`hotel-terminal`
 * พร้อมกันโดยยังไม่ได้ไล่ endpoint ของแต่ละระบบ = ทำระบบหลังบ้านพังยกแผง
 *
 * เพิ่มระบบใหม่: ไล่ endpoint ที่ frontend ของระบบนั้นเรียก → ติด `@AllowSystems`
 * ให้ครบ → ค่อยเติมชื่อลง set นี้
 */
const ALL_SYSTEMS: ReadonlySet<string> = new Set([
  'main', 'pos', 'procurement', 'warehouse', 'hotel-terminal', 'accounting', 'hr',
  'camp-terminal', 'retail', 'crm',
]);

function systemsFromEnv(name: string, fallback: SystemContext[]): ReadonlySet<SystemContext> {
  const raw = process.env[name];
  if (raw === undefined) return new Set(fallback);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SystemContext => ALL_SYSTEMS.has(s) && s !== 'main'),
  );
}

/**
 * H1 (audit 2026-11-09): rolled out one terminal at a time.
 *  - ENFORCED: default deny — only @AllowSystems(...) endpoints.
 *  - REPORT:   allowed through, but every call outside the allow-list is logged
 *              (and, outside production, appended to logs/system-guard-report.jsonl)
 *              so the list can be completed before the terminal is enforced.
 * Override per environment with SYSTEM_GUARD_ENFORCE / SYSTEM_GUARD_REPORT (comma lists).
 */
export const ENFORCED_SYSTEMS: ReadonlySet<SystemContext> = systemsFromEnv('SYSTEM_GUARD_ENFORCE', [
  'pos',
  // each allow-list completed by a report-mode walk of every page (2026-11-09)
  'hotel-terminal',
  'hr',
  'accounting',
  'procurement',
  'warehouse',
  // main-session terminals on a scoped token (H1.2) — walked 2026-11-09
  'retail',
  'crm',
]);
export const REPORT_SYSTEMS: ReadonlySet<SystemContext> = systemsFromEnv('SYSTEM_GUARD_REPORT', [
  // not walkable yet: no tenant with the CAMP product in the QA data — move to
  // ENFORCE after a full report-mode walk of /camp-terminal
  'camp-terminal',
]);

interface SystemClaims {
  systemContext?: SystemContext;
  /** H1.2 — a main-session token scoped to Camp / Retail / CRM */
  terminals?: SystemContext[];
  posLaunch?: boolean;
  isPlatformAdmin?: boolean;
}

const SYSTEM_NAMES: Record<SystemContext, string> = {
  main: 'Hotel Management Portal',
  pos: 'POS System',
  procurement: 'Procurement System',
  warehouse: 'Warehouse System',
  'hotel-terminal': 'Hotel Management Terminal',
  accounting: 'Accounting System',
  hr: 'HR Terminal',
  'camp-terminal': 'Campground Terminal',
  retail: 'Retail POS',
  crm: 'CRM Terminal',
};

@Injectable()
export class SystemGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // WebSocket / RPC handlers have no HTTP request to read a bearer token from.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const claims = this.readClaims(context);

    // No token, or one this guard cannot read. Not its problem: JwtAuthGuard runs
    // after it and rejects the request. Failing closed here would 403 every
    // unauthenticated call to a public-by-omission route with a 403 instead of a 401.
    if (!claims) return true;

    // Platform admins are not scoped to a tenant, let alone to one of its terminals.
    if (claims.isPlatformAdmin) return true;

    // A pos-launch token is a deep-link hand-off minted by the dashboard
    // (auth.service.generatePosLaunchToken). It carries the *manager's* role and no
    // systemContext, so without this it would read as `main` and skip enforcement.
    const effectiveSystem: SystemContext = claims.posLaunch
      ? 'pos'
      : (claims.systemContext ?? 'main');

    // A scoped main-session token (Camp / Retail / CRM staff) acts as its terminals.
    const scoped =
      effectiveSystem === 'main' && Array.isArray(claims.terminals) && claims.terminals.length > 0
        ? claims.terminals.filter((t): t is SystemContext => ALL_SYSTEMS.has(t) && t !== 'main')
        : null;
    const systems: SystemContext[] = scoped && scoped.length > 0 ? scoped : [effectiveSystem];

    const enforced = systems.some((s) => ENFORCED_SYSTEMS.has(s));
    const reported = !enforced && systems.some((s) => REPORT_SYSTEMS.has(s));
    if (!enforced && !reported) return true;

    // Merge handler + class: a handler tagged @AllowSystems('pos') inside a class
    // tagged @AllowSystems('hotel-terminal') must stay open to both.
    const allowedSystems =
      this.reflector.getAllAndMerge<SystemContext[]>(ALLOW_SYSTEMS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (systems.some((s) => allowedSystems.includes(s))) return true;

    if (reported) {
      this.report(context, systems.join('+') as SystemContext);
      return true;
    }

    throw new ForbiddenException({
      code: 'WRONG_SYSTEM_CONTEXT',
      message: `This endpoint is not part of the ${SYSTEM_NAMES[systems[0]] ?? systems[0]}. Please log in via the correct system.`,
      // Under `details` so `AllExceptionsFilter` forwards it — the filter emits
      // only { code, message, details } and the browser needs this field to tell
      // "wrong terminal, log in again" from "right terminal, endpoint out of
      // reach". Any other spelling reaches the client as a bare 403.
      details: { currentSystem: systems[0] },
    });
  }

  private readonly reported = new Set<string>();

  /** Log (once per route) a call a reported terminal makes outside its allow-list. */
  private report(context: ExecutionContext, system: SystemContext): void {
    const req = context.switchToHttp().getRequest<{ method?: string; route?: { path?: string } }>();
    const route = `${req?.method ?? '?'} ${req?.route?.path ?? '?'}`;
    const key = `${system} ${route}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[SystemGuard:report] ${system} → ${route} (not in @AllowSystems — would be 403 when enforced)`);
    if (process.env.NODE_ENV === 'production' || process.env.JEST_WORKER_ID) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      fs.mkdirSync('logs', { recursive: true });
      fs.appendFileSync(
        'logs/system-guard-report.jsonl',
        JSON.stringify({ at: new Date().toISOString(), system, route }) + '\n',
      );
    } catch {
      /* reporting must never break a request */
    }
  }

  /** อ่าน claim ที่เกี่ยวกับระบบจาก bearer token โดยไม่ยุ่งกับการ authenticate */
  private readClaims(context: ExecutionContext): SystemClaims | null {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const header = request?.headers?.['authorization'];

    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
      return null;
    }

    try {
      return this.jwtService.verify<SystemClaims>(header.slice(7).trim());
    } catch {
      return null;
    }
  }
}

// rollout notes: docs/security/2026-11-09-access-and-tenant-isolation-audit.md (H1)

// H1.2: scoped main-session tokens (camp / retail / crm) — see terminal-registry mainSessionScope
