import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AddonCode, AddonService } from '@/modules/addons/addon.service';
import { PrismaService } from '@/prisma/prisma.service';
import { REQUIRE_ADDON_KEY } from '../decorators/require-addon.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * AddonGuard — Generic backend enforcement for subscription add-ons.
 *
 * Works together with @RequireAddon('ADDON_CODE') decorator.
 * Must be placed AFTER JwtAuthGuard so request.user is populated.
 *
 * Behavior:
 *  - If endpoint has no @RequireAddon() → allow (not an add-on gated route)
 *  - If endpoint is @Public() → allow
 *  - If tenant is on TRIAL → allow full access (matches UI "Full Access" trial)
 *  - If tenant has the required add-on active → allow
 *  - Otherwise → 403 with structured error body for frontend upgrade redirect
 *
 * @example
 * // Controller level — all endpoints require POS_MODULE
 * @UseGuards(JwtAuthGuard, AddonGuard)
 * @RequireAddon('POS_MODULE')
 * @Controller('restaurant')
 * export class RestaurantController {}
 *
 * // Method level override — specific endpoint requires different add-on
 * @RequireAddon('HR_MODULE')
 * @Get('employees')
 * getEmployees() {}
 */
@Injectable()
export class AddonGuard implements CanActivate {
  private readonly logger = new Logger(AddonGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly addonService: AddonService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1) Public routes bypass all checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 2) No @RequireAddon() metadata → not an add-on gated route
    const requiredAddon = this.reflector.getAllAndOverride<AddonCode>(REQUIRE_ADDON_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredAddon) return true;

    // 3) Extract tenant from JWT (populated by JwtAuthGuard)
    const request = context.switchToHttp().getRequest<{
      user?: { tenantId?: string; role?: string };
    }>();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      this.logger.warn(`AddonGuard: tenantId missing in JWT payload — denying access`);
      throw new ForbiddenException({
        code: `${requiredAddon}_REQUIRED`,
        message: `This feature requires an active add-on subscription.`,
        addon: requiredAddon,
        upgradeUrl: '/billing/addons',
      });
    }

    // 4) Platform admins bypass add-on checks
    const role = request.user?.role ?? '';
    if (role === 'platform_admin' || role === 'super_admin' || role === 'admin') {
      return true;
    }

    // 5) Trial tenants get full access
    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId },
      select: { status: true },
      orderBy: { created_at: 'desc' },
    });

    if (subscription?.status === 'trial') {
      return true;
    }

    // 6) Paid tenants: enforce add-on check
    const hasAddon = await this.addonService.hasActiveAddon(tenantId, requiredAddon);

    if (!hasAddon) {
      this.logger.warn(
        `Tenant ${tenantId} (role: ${role}) attempted access to ${requiredAddon}-gated ` +
          `endpoint "${context.getHandler().name}" without active add-on`,
      );
      throw new ForbiddenException({
        code: `${requiredAddon}_REQUIRED`,
        message: `This feature requires the "${requiredAddon}" add-on to be active on your subscription.`,
        addon: requiredAddon,
        upgradeUrl: '/billing/addons',
      });
    }

    return true;
  }
}
