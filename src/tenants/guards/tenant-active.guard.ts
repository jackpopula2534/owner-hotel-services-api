import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantStatus } from '../entities/tenant.entity';

export const TENANT_ACTIVE_BYPASS_KEY = 'tenantActiveBypass';

/**
 * Block requests when the tenant is not in an operational lifecycle state.
 *
 * - TRIAL / ACTIVE   → allowed
 * - PAST_DUE         → allowed (read-only, enforced by per-route logic)
 * - SUSPENDED / EXPIRED / CANCELLED / ARCHIVED → 403
 *
 * The guard reads tenantId from `request.user.tenantId` (set by JwtAuthGuard).
 * Public endpoints can opt out by setting the route metadata `tenantActiveBypass`.
 */
@Injectable()
export class TenantActiveGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bypass = this.reflector.getAllAndOverride<boolean>(TENANT_ACTIVE_BYPASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.tenantId || req.tenantId;
    if (!tenantId) return true; // not a tenant-scoped route

    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant) {
      throw new ForbiddenException('Tenant not found');
    }

    const blocked: TenantStatus[] = [
      TenantStatus.SUSPENDED,
      TenantStatus.EXPIRED,
      TenantStatus.CANCELLED,
      TenantStatus.ARCHIVED,
    ];
    if (blocked.includes(tenant.status as TenantStatus)) {
      throw new ForbiddenException(
        `Workspace is ${tenant.status}. Please contact support or settle outstanding invoices to reactivate.`,
      );
    }

    return true;
  }
}
