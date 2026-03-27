import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus } from './entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSubscriptionDto: CreateSubscriptionDto) {
    const data: any = {
      subscription_code: createSubscriptionDto.subscriptionCode,
      tenant_id: createSubscriptionDto.tenantId,
      plan_id: createSubscriptionDto.planId,
      previous_plan_id: createSubscriptionDto.previousPlanId,
      status: createSubscriptionDto.status,
      start_date: createSubscriptionDto.startDate,
      end_date: createSubscriptionDto.endDate,
      auto_renew:
        createSubscriptionDto.autoRenew !== undefined
          ? createSubscriptionDto.autoRenew
            ? 1
            : 0
          : 1,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.subscriptions.create({
      data,
      include: {
        tenants: true,
        plans_subscriptions_plan_idToplans: true,
        subscription_features: { include: { features: true } },
      },
    });
  }

  findAll() {
    return this.prisma.subscriptions.findMany({
      include: {
        tenants: true,
        plans_subscriptions_plan_idToplans: {
          include: { plan_features: { include: { features: true } } },
        },
        subscription_features: { include: { features: true } },
      },
    });
  }

  findOne(id: string) {
    return this.prisma.subscriptions.findUnique({
      where: { id },
      include: {
        tenants: true,
        plans_subscriptions_plan_idToplans: {
          include: { plan_features: { include: { features: true } } },
        },
        subscription_features: { include: { features: true } },
      },
    });
  }

  findByTenantId(tenantId: string) {
    return this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId },
      include: {
        plans_subscriptions_plan_idToplans: {
          include: { plan_features: { include: { features: true } } },
        },
        subscription_features: { include: { features: true } },
      },
    });
  }

  update(id: string, updateSubscriptionDto: UpdateSubscriptionDto) {
    return this.prisma.subscriptions.update({
      where: { id },
      data: updateSubscriptionDto,
      include: {
        tenants: true,
        plans_subscriptions_plan_idToplans: true,
        subscription_features: { include: { features: true } },
      },
    });
  }

  remove(id: string) {
    return this.prisma.subscriptions.delete({
      where: { id },
    });
  }

  async checkSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.findByTenantId(tenantId);
    if (!subscription) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.end_date);
    endDate.setHours(0, 0, 0, 0);

    return subscription.status === SubscriptionStatus.ACTIVE && endDate >= today;
  }

  /**
   * Verify that a tenant has an active (non-trial, non-expired) subscription
   * This is used to enforce that each tenant MUST have its own subscription
   */
  async requireActiveSubscription(tenantId: string): Promise<boolean> {
    const subscription = await this.findByTenantId(tenantId);
    if (!subscription) {
      return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(subscription.end_date);
    endDate.setHours(0, 0, 0, 0);

    // Must be active status (not trial or pending) and not expired
    const isActive = subscription.status === SubscriptionStatus.ACTIVE && endDate >= today;
    return isActive;
  }
}
