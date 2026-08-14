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
const ENFORCED_SYSTEMS: ReadonlySet<SystemContext> = new Set<SystemContext>(['pos']);

interface SystemClaims {
  systemContext?: SystemContext;
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

    if (!ENFORCED_SYSTEMS.has(effectiveSystem)) return true;

    const allowedSystems =
      this.reflector.getAllAndOverride<SystemContext[]>(ALLOW_SYSTEMS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (allowedSystems.includes(effectiveSystem)) return true;

    throw new ForbiddenException({
      code: 'WRONG_SYSTEM_CONTEXT',
      message: `This endpoint is not part of the ${SYSTEM_NAMES[effectiveSystem]}. Please log in via the correct system.`,
      // Under `details` so `AllExceptionsFilter` forwards it — the filter emits
      // only { code, message, details } and the browser needs this field to tell
      // "wrong terminal, log in again" from "right terminal, endpoint out of
      // reach". Any other spelling reaches the client as a bare 403.
      details: { currentSystem: effectiveSystem },
    });
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
