import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** The only claims this guard reads. Everything else is JwtAuthGuard's business. */
interface TenantClaims {
  tenantId?: string | null;
  role?: string;
  isPlatformAdmin?: boolean;
}

/**
 * TenantGuard — บล็อกการอ่านข้อมูลข้าม tenant ผ่าน URL
 *
 * ถ้า route มี `:tenantId` (หรือ `?tenantId=`) แล้วค่านั้นไม่ตรงกับ `tenantId`
 * ใน JWT → 403 เช่น manager ของ tenant A ยิง `/hotels/tenant-B/bookings`
 *
 * มันอ่าน claim จาก bearer token เอง ไม่ใช่จาก `request.user`
 * ------------------------------------------------------------------
 * guard ตัวนี้ลงทะเบียนเป็น global `APP_GUARD` และ Nest รัน global guard
 * **ก่อน** guard ระดับ controller เสมอ — repo นี้ไม่มี global JwtAuthGuard
 * (แต่ละ controller ติด `@UseGuards(JwtAuthGuard)` เอง) แปลว่าตอน guard นี้รัน
 * passport ยังไม่ทำงาน `request.user` จึงเป็น `undefined` ทุกครั้ง
 *
 * โค้ดเดิมอ่าน `request.user?.tenantId` แล้ว `if (!jwtTenantId) return true`
 * → เงื่อนไขนั้นเป็นจริง**ทุก request** guard เลยไม่เคยบล็อกอะไรเลยสักครั้ง
 * (ยืนยันด้วย e2e ใน `tenant.guard.spec.ts`: ก่อนแก้ tenant A อ่าน tenant B ได้ 200)
 *
 * comment เดิมอ้างว่าปลอดภัยเพราะมี Prisma tenant-scope middleware รองรับ —
 * ไม่จริง: middleware ข้าม model ที่ไม่อยู่ใน `TENANT_SCOPED_MODELS` (ตอนนี้ยังขาด
 * CRM/accounting/folio/HR อีกจำนวนมาก) และมันยัง "เคารพ" `tenantId` ที่ caller
 * ส่งมาเอง ซึ่งก็คือค่าที่หลุดมาจาก URL นี่แหละ
 *
 * มันไม่ authenticate — JwtAuthGuard ทำหน้าที่นั้น
 * ------------------------------------------------------------------
 * ไม่มี token / token เสีย → `return true` ปล่อยให้ JwtAuthGuard ตอบ 401
 * ถ้า fail closed ตรงนี้ API จะตอบ 403 ในที่ที่ต้องตอบ 401 และ public webhook
 * ที่มี `:tenantId` (เช่น `POST /messaging/line/webhook/:tenantId`) จะพังทันที
 *
 * @see SystemGuard — global guard ตัวพี่ที่ใช้แพตเทิร์นเดียวกัน
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
      params?: Record<string, string>;
      query?: Record<string, string>;
    }>();

    // Cheapest check first: no tenant in the URL → nothing to compare, and no
    // reason to pay for a signature verification on every request in the API.
    const paramTenantId = request.params?.['tenantId'] ?? request.params?.['tenant_id'];
    const queryTenantId = request.query?.['tenantId'] ?? request.query?.['tenant_id'];
    const routeTenantId = paramTenantId ?? queryTenantId;
    if (!routeTenantId) return true;

    const claims = this.readClaims(request.headers?.['authorization']);
    if (!claims) return true; // let JwtAuthGuard answer 401, not us with a 403

    // Cross-tenant access is granted by the `isPlatformAdmin` claim ONLY. It is
    // derived from which table the account authenticated against, never from
    // `User.role` — `'admin'` is a legacy TENANT-level role name, so a role
    // allowlist here would wave ordinary hotel users straight through.
    if (claims.isPlatformAdmin) return true;

    // A non-platform token with no tenant identity has no business on a
    // tenant-scoped URL. Fail closed.
    if (!claims.tenantId || claims.tenantId !== routeTenantId) {
      this.logger.warn(
        `TenantGuard: Cross-tenant access blocked. ` +
          `JWT tenantId="${claims.tenantId ?? '<none>'}", route tenantId="${routeTenantId}", ` +
          `role="${claims.role ?? ''}"`,
      );
      throw new ForbiddenException({
        code: 'CROSS_TENANT_ACCESS',
        message: 'You do not have permission to access resources belonging to another tenant.',
      });
    }

    return true;
  }

  /** อ่าน tenant claim จาก bearer token โดยไม่ยุ่งกับการ authenticate */
  private readClaims(header: unknown): TenantClaims | null {
    if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) return null;
    try {
      return this.jwtService.verify<TenantClaims>(header.slice(7).trim());
    } catch {
      return null;
    }
  }
}
