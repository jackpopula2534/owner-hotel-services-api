import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AddonService, ADDON_CODES } from '@/modules/addons/addon.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * HrAddonGuard
 *
 * Enforces that the current tenant has an active HR_MODULE add-on subscription.
 * Apply this guard to any endpoint that requires the HR paid add-on.
 *
 * Trial tenants (status = 'trial') receive full access automatically —
 * matching the "Trial Free Trial (Full Access)" banner shown in the UI.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, HrAddonGuard)
 *   @Get()
 *   findAll() { ... }
 *
 * When the add-on is inactive the guard throws HTTP 403 with a structured error
 * body so the frontend can redirect to the billing/add-ons upgrade page.
 */
@Injectable()
export class HrAddonGuard implements CanActivate {
  private readonly logger = new Logger(HrAddonGuard.name);

  constructor(
    private readonly addonService: AddonService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = request.user?.tenantId;

    if (!tenantId) {
      throw new ForbiddenException({
        code: 'HR_ADDON_REQUIRED',
        message: 'HR Module add-on is required to access this feature.',
        upgradeUrl: '/billing/addons',
      });
    }

    // ─── Trial tenants get full access (matches "Full Access" trial behavior) ──
    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId },
      select: { status: true },
      orderBy: { created_at: 'desc' },
    });

    if (subscription?.status === 'trial') {
      return true;
    }

    // ─── Paid tenants: check HR_MODULE add-on ──────────────────────────────────
    const hasAddon = await this.addonService.hasActiveAddon(tenantId, ADDON_CODES.HR_MODULE);

    if (!hasAddon) {
      this.logger.warn(`Tenant ${tenantId} attempted HR access without HR_MODULE add-on`);
      throw new ForbiddenException({
        code: 'HR_ADDON_REQUIRED',
        message: 'HR Module add-on is required to access this feature.',
        upgradeUrl: '/billing/addons',
      });
    }

    return true;
  }
}
