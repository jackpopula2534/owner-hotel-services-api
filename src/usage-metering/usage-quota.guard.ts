import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsageMeteringService } from './usage-metering.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Decorator + guard that enforces per-plan usage limits.
 *
 * @UseGuards(UsageQuotaGuard)
 * @CheckQuota('bookings_per_month')
 * createBooking() { ... }
 *
 * The guard reads the plan's max_<metric_code> column (or falls back to
 * the metric's own `included_amount` config). When usage >= limit it
 * raises 402 Payment Required with a JSON body the frontend can use to
 * promote upgrade.
 */
export const QUOTA_METRIC_KEY = 'usage_quota_metric';
export const CheckQuota =
  (metricCode: string): MethodDecorator =>
  (_target, _key, descriptor) => {
    Reflect.defineMetadata(QUOTA_METRIC_KEY, metricCode, descriptor.value as object);
    return descriptor;
  };

@Injectable()
export class UsageQuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageMeteringService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metricCode = this.reflector.getAllAndOverride<string>(QUOTA_METRIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metricCode) return true;

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.tenantId || req.tenantId;
    if (!tenantId) return true;

    const subscription = await (this.prisma as any).subscriptions.findFirst({
      where: { tenant_id: tenantId },
      include: { plans_subscriptions_plan_idToplans: true },
      orderBy: { created_at: 'desc' },
    });
    const plan = subscription?.plans_subscriptions_plan_idToplans;
    if (!plan) return true; // no plan → no enforcement

    // Convention: plan column is max_<metric_code>. Fall back to no limit.
    const limit: number | null =
      typeof plan[`max_${metricCode}`] === 'number' ? plan[`max_${metricCode}`] : null;
    if (limit == null || limit <= 0) return true; // unlimited

    const snap = await this.usage.getSnapshot(tenantId, metricCode);
    if (snap.value >= limit) {
      throw new HttpException(
        {
          code: 'QUOTA_EXCEEDED',
          message: `You have reached your plan's monthly limit for ${metricCode}.`,
          metric: metricCode,
          used: snap.value,
          limit,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
