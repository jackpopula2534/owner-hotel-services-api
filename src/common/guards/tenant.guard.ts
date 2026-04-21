import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * TenantGuard — Prevents cross-tenant data access.
 *
 * Ensures that the `tenantId` in the JWT matches the `tenantId` in
 * route params or query string when the route exposes tenant-scoped
 * resources (e.g. /hotels/:tenantId/bookings).
 *
 * This guard is a SAFETY NET on top of Prisma queries that already
 * filter by tenantId. It adds a defense-in-depth layer so that even
 * if a service accidentally omits the tenantId filter, the request is
 * blocked before reaching the service layer.
 *
 * Behavior:
 *  - If the route has no :tenantId param AND no tenantId query → skip (no cross-tenant risk)
 *  - Platform admins (platform_admin, super_admin, admin) bypass all checks
 *  - If JWT tenantId ≠ param/query tenantId → 403 FORBIDDEN
 *
 * Usage (apply globally or per-controller):
 *   @UseGuards(JwtAuthGuard, TenantGuard)
 *   @Controller('hotels/:tenantId/bookings')
 *   export class BookingController {}
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger(TenantGuard.name);

  private readonly PLATFORM_ROLES = ['platform_admin', 'super_admin', 'admin'];

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { tenantId?: string; role?: string };
      params?: Record<string, string>;
      query?: Record<string, string>;
    }>();

    const userRole = request.user?.role ?? '';
    const jwtTenantId = request.user?.tenantId;

    // Platform admins can access any tenant's data
    if (this.PLATFORM_ROLES.includes(userRole)) return true;

    // Extract tenantId from route params or query string
    const paramTenantId = request.params?.['tenantId'] ?? request.params?.['tenant_id'];
    const queryTenantId = request.query?.['tenantId'] ?? request.query?.['tenant_id'];
    const routeTenantId = paramTenantId ?? queryTenantId;

    // No tenant-scoped resource in this route → nothing to check
    if (!routeTenantId) return true;

    // tenantId exists in route but user has no tenantId in JWT
    if (!jwtTenantId) {
      this.logger.warn(
        `TenantGuard: user role="${userRole}" has no tenantId in JWT, ` +
          `but route requires tenantId="${routeTenantId}"`,
      );
      throw new ForbiddenException({
        code: 'TENANT_REQUIRED',
        message: 'Your session is not associated with a tenant. Please log in again.',
      });
    }

    // Cross-tenant attempt — block
    if (jwtTenantId !== routeTenantId) {
      this.logger.warn(
        `TenantGuard: Cross-tenant access blocked. ` +
          `JWT tenantId="${jwtTenantId}", route tenantId="${routeTenantId}", ` +
          `role="${userRole}"`,
      );
      throw new ForbiddenException({
        code: 'CROSS_TENANT_ACCESS',
        message: 'You do not have permission to access resources belonging to another tenant.',
      });
    }

    return true;
  }
}
