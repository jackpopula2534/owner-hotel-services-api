import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { Plan } from '../plans/entities/plan.entity';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminSubscriptionsQueryDto,
  AdminSubscriptionsListResponseDto,
  AdminSubscriptionListItemDto,
  AdminSubscriptionsSummaryDto,
  AdminSubscriptionDetailDto,
  UpdateSubscriptionStatusDto,
  SubscriptionStatusUpdateResponseDto,
  AdminSubscriptionStatusFilter,
  AdminSubscriptionStatusUpdate,
  SubscriptionAddonDto,
} from './dto/admin-subscriptions.dto';

@Injectable()
export class AdminSubscriptionsService {
  private readonly logger = new Logger(AdminSubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(SubscriptionFeature)
    private subscriptionFeaturesRepository: Repository<SubscriptionFeature>,
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
    private prismaService: PrismaService,
  ) {}

  private async getPlanAddonsByPlanIds(
    planIds: string[],
  ): Promise<Map<string, Array<{ name: string; price: number }>>> {
    const uniquePlanIds = [...new Set(planIds.filter(Boolean))];
    const grouped = new Map<string, Array<{ name: string; price: number }>>();

    for (const planId of uniquePlanIds) {
      const rows = await this.prismaService.$queryRaw<
        Array<{ name: string; price: number | string | null }>
      >`
        SELECT a.name, a.price
        FROM plan_addons pa
        INNER JOIN add_ons a ON a.id = pa.addon_id
        WHERE pa.plan_id = ${planId}
          AND a.is_active = 1
      `;

      grouped.set(
        planId,
        rows.map((row) => ({
          name: row.name,
          price: Number(row.price || 0),
        })),
      );
    }

    return grouped;
  }

  /**
   * A subscription only generates revenue while it is ACTIVE. Trial, pending,
   * expired and cancelled subscriptions have NOT been charged yet, so their
   * billable amount must be 0 (the list price is still surfaced separately for
   * "struck-through" display in the UI).
   */
  private isBillableStatus(status: SubscriptionStatus): boolean {
    return status === SubscriptionStatus.ACTIVE;
  }

  /**
   * Period boundaries carry a real expiry *moment* (e.g. trial ending at noon),
   * so we send the full ISO datetime and let the client format date + time.
   * Returns 'N/A' when there is no date.
   */
  private toIsoOrNa(date: Date | string | null | undefined): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString();
  }

  /**
   * Centralised pricing rule for a subscription.
   *
   * - Bundled add-ons (รวมในแพ็กเกจ) are included in the plan price, so their
   *   billed amount is always 0 — only their list price (originalPrice) is kept
   *   for display.
   * - Purchased add-ons are billed at their list price, but only when the
   *   subscription is in a billable (ACTIVE) state.
   * - plan price is billed only when the subscription is billable.
   */
  private computePricing(
    status: SubscriptionStatus,
    planPrice: number,
    bundledAddons: Array<{ name: string; price: number }>,
    purchasedAddons: Array<{ name: string; price: number }>,
  ): {
    addons: Array<{
      name: string;
      price: number;
      originalPrice: number;
      isBundled: boolean;
      isBilled: boolean;
    }>;
    addonAmount: number;
    addonOriginalAmount: number;
    pricePerMonth: number;
    originalPricePerMonth: number;
    isTrial: boolean;
  } {
    const billable = this.isBillableStatus(status);

    const mappedBundled = bundledAddons.map((a) => ({
      name: a.name,
      // Bundled add-ons never add to the bill — their cost is part of the plan.
      price: 0,
      originalPrice: a.price,
      isBundled: true,
      isBilled: false,
    }));

    const mappedPurchased = purchasedAddons.map((a) => ({
      name: a.name,
      // Purchased add-ons are billed only when the subscription is billable.
      price: billable ? a.price : 0,
      originalPrice: a.price,
      isBundled: false,
      isBilled: billable && a.price > 0,
    }));

    const addons = [...mappedBundled, ...mappedPurchased];

    const addonAmount = addons.reduce((sum, a) => sum + a.price, 0);
    const addonOriginalAmount = addons.reduce((sum, a) => sum + a.originalPrice, 0);

    const pricePerMonth = (billable ? planPrice : 0) + addonAmount;
    const originalPricePerMonth = planPrice + addonOriginalAmount;

    return {
      addons,
      addonAmount,
      addonOriginalAmount,
      pricePerMonth,
      originalPricePerMonth,
      isTrial: !billable,
    };
  }

  /**
   * GET /api/admin/subscriptions
   * Get all subscriptions with filtering, search, and pagination
   */
  async findAll(query: AdminSubscriptionsQueryDto): Promise<AdminSubscriptionsListResponseDto> {
    const { status, search, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    // Build query
    const queryBuilder = this.subscriptionsRepository
      .createQueryBuilder('subscription')
      .leftJoinAndSelect('subscription.tenant', 'tenant')
      .leftJoinAndSelect('subscription.plan', 'plan')
      .leftJoinAndSelect('subscription.previousPlan', 'previousPlan')
      .leftJoinAndSelect('subscription.subscriptionFeatures', 'subscriptionFeatures')
      .leftJoinAndSelect('subscriptionFeatures.feature', 'feature');

    // Filter by status
    if (status && status !== AdminSubscriptionStatusFilter.ALL) {
      const statusMap: Record<string, SubscriptionStatus> = {
        active: SubscriptionStatus.ACTIVE,
        trial: SubscriptionStatus.TRIAL,
        pending: SubscriptionStatus.PENDING,
        expired: SubscriptionStatus.EXPIRED,
      };
      queryBuilder.andWhere('subscription.status = :status', {
        status: statusMap[status],
      });
    }

    // Search by hotel name, subscription code, tenant email, or owner login email
    if (search) {
      // Use Prisma to find tenantIds whose tenant_admin email matches the search term.
      // This avoids a raw JOIN whose column names may differ between TypeORM and Prisma.
      const matchingUsers = await this.prismaService.user.findMany({
        where: { email: { contains: search }, role: 'tenant_admin' },
        select: { tenantId: true },
      });
      const tenantIdsByEmail = [
        ...new Set(matchingUsers.map((u) => u.tenantId).filter(Boolean) as string[]),
      ];

      const conditions: string[] = [
        'tenant.name LIKE :search',
        'subscription.subscriptionCode LIKE :search',
        'tenant.email LIKE :search',
      ];
      const params: Record<string, any> = { search: `%${search}%` };

      if (tenantIdsByEmail.length > 0) {
        conditions.push('subscription.tenantId IN (:...tenantIdsByEmail)');
        params.tenantIdsByEmail = tenantIdsByEmail;
      }

      queryBuilder.andWhere(`(${conditions.join(' OR ')})`, params);
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and order
    queryBuilder.orderBy('subscription.createdAt', 'DESC').skip(skip).take(limit);

    const subscriptions = await queryBuilder.getMany();
    const bundledAddonsByPlanId = await this.getPlanAddonsByPlanIds(
      subscriptions.map((sub) => sub.planId).filter(Boolean),
    );

    // Batch-fetch owner emails for all subscriptions on this page (single Prisma query)
    const tenantIds = [
      ...new Set(subscriptions.map((s) => s.tenantId).filter(Boolean)),
    ] as string[];
    const ownerUsers = tenantIds.length
      ? await this.prismaService.user.findMany({
          where: { tenantId: { in: tenantIds }, role: 'tenant_admin' },
          select: { tenantId: true, email: true },
        })
      : [];
    const ownerEmailMap = new Map<string, string>(
      ownerUsers.map((u) => [u.tenantId as string, u.email]),
    );

    // Transform to response format
    const data: AdminSubscriptionListItemDto[] = subscriptions.map((sub) => {
      const bundledAddons = bundledAddonsByPlanId.get(sub.planId) || [];

      // Build add-ons array with both bundled plan_addons and purchased subscription_features.
      const subscriptionFeatures = sub.subscriptionFeatures || [];
      const purchasedAddons = subscriptionFeatures.map((sf) => ({
        name: sf.feature?.name || 'Unknown',
        price: Number(sf.price || 0),
      }));

      // Apply status-aware pricing rules (bundled -> 0, non-active -> not billed).
      const planPrice = Number(sub.plan?.priceMonthly || 0);
      const pricing = this.computePricing(sub.status, planPrice, bundledAddons, purchasedAddons);

      // Format status for display
      const statusDisplay = this.formatStatus(sub.status);

      // Get previous plan name if exists (for upgrade/downgrade indicator)
      const previousPlanName = sub.previousPlan?.name || undefined;

      return {
        id: sub.id,
        subscriptionCode: sub.subscriptionCode || `SUB-${sub.id.slice(0, 3).toUpperCase()}`,
        hotelName: sub.tenant?.name || 'N/A',
        ownerEmail: ownerEmailMap.get(sub.tenantId) || undefined,
        plan: sub.plan?.name || 'No Plan',
        previousPlan: previousPlanName,
        period: {
          // Full ISO datetime so the client can show date + time of expiry.
          start: this.toIsoOrNa(sub.startDate),
          end: this.toIsoOrNa(sub.endDate),
        },
        addons: pricing.addons,
        addonAmount: pricing.addonAmount,
        addonOriginalAmount: pricing.addonOriginalAmount,
        pricePerMonth: pricing.pricePerMonth,
        originalPricePerMonth: pricing.originalPricePerMonth,
        isTrial: pricing.isTrial,
        status: statusDisplay,
      };
    });

    return {
      total,
      page,
      limit,
      data,
    };
  }

  /**
   * GET /api/admin/subscriptions/summary
   * Get subscriptions summary for dashboard
   */
  async getSummary(): Promise<AdminSubscriptionsSummaryDto> {
    // Count by status
    const [active, trial, pending, expired] = await Promise.all([
      this.subscriptionsRepository.count({
        where: { status: SubscriptionStatus.ACTIVE },
      }),
      this.subscriptionsRepository.count({
        where: { status: SubscriptionStatus.TRIAL },
      }),
      this.subscriptionsRepository.count({
        where: { status: SubscriptionStatus.PENDING },
      }),
      this.subscriptionsRepository.count({
        where: { status: SubscriptionStatus.EXPIRED },
      }),
    ]);

    // Calculate MRR (Monthly Recurring Revenue) from active subscriptions
    const activeSubscriptions = await this.subscriptionsRepository.find({
      where: { status: SubscriptionStatus.ACTIVE },
      relations: ['plan', 'subscriptionFeatures'],
    });

    let mrr = 0;
    for (const sub of activeSubscriptions) {
      const planPrice = Number(sub.plan?.priceMonthly || 0);
      const addonPrice = (sub.subscriptionFeatures || []).reduce(
        (sum, sf) => sum + Number(sf.price || 0),
        0,
      );
      mrr += planPrice + addonPrice;
    }

    // Count upgrades (has previousPlan and current plan is higher tier)
    const allSubscriptions = await this.subscriptionsRepository.find({
      relations: ['plan', 'previousPlan'],
    });

    let upgrades = 0;
    let downgrades = 0;

    for (const sub of allSubscriptions) {
      if (sub.previousPlan && sub.plan) {
        const currentPrice = Number(sub.plan.priceMonthly || 0);
        const previousPrice = Number(sub.previousPlan.priceMonthly || 0);

        if (currentPrice > previousPrice) {
          upgrades++;
        } else if (currentPrice < previousPrice) {
          downgrades++;
        }
      }
    }

    return {
      active,
      trial,
      pending,
      expired,
      mrr,
      upgrades,
      downgrades,
    };
  }

  /**
   * GET /api/admin/subscriptions/:id
   * Get subscription detail by ID
   */
  async findOne(id: string): Promise<AdminSubscriptionDetailDto> {
    // Find subscription by code (SUB-001) or by UUID
    let subscription: Subscription | null = null;

    if (id.startsWith('SUB-')) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { subscriptionCode: id },
        relations: [
          'tenant',
          'plan',
          'previousPlan',
          'subscriptionFeatures',
          'subscriptionFeatures.feature',
          'invoices',
        ],
      });
    }

    if (!subscription) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { id },
        relations: [
          'tenant',
          'plan',
          'previousPlan',
          'subscriptionFeatures',
          'subscriptionFeatures.feature',
          'invoices',
        ],
      });
    }

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    // Get owner email
    const owner = await this.prismaService.user.findFirst({
      where: {
        tenantId: subscription.tenantId,
        role: 'tenant_admin',
      },
    });

    const bundledAddonsByPlanId = await this.getPlanAddonsByPlanIds([subscription.planId]);
    const bundledAddons = bundledAddonsByPlanId.get(subscription.planId) || [];

    // Build purchased add-ons list (subscription_features)
    const purchasedAddons = (subscription.subscriptionFeatures || []).map((sf) => ({
      name: sf.feature?.name || 'Unknown',
      price: Number(sf.price || 0),
    }));

    // Apply status-aware pricing rules (bundled -> 0, non-active -> not billed).
    const planPrice = Number(subscription.plan?.priceMonthly || 0);
    const pricing = this.computePricing(
      subscription.status,
      planPrice,
      bundledAddons,
      purchasedAddons,
    );
    const addons: SubscriptionAddonDto[] = pricing.addons;
    const pricePerMonth = pricing.pricePerMonth;

    // Get latest invoice
    const latestInvoice = subscription.invoices?.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    return {
      id: subscription.id,
      subscriptionCode:
        subscription.subscriptionCode || `SUB-${subscription.id.slice(0, 3).toUpperCase()}`,
      planId: subscription.planId || undefined,
      hotelName: subscription.tenant?.name || 'N/A',
      hotelEmail: owner?.email || 'N/A',
      plan: subscription.plan?.name || 'No Plan',
      previousPlan: subscription.previousPlan?.name || undefined,
      addons,
      period: {
        // Full ISO datetime so the client can show date + time of expiry.
        start: this.toIsoOrNa(subscription.startDate),
        end: this.toIsoOrNa(subscription.endDate),
      },
      pricePerMonth,
      originalPricePerMonth: pricing.originalPricePerMonth,
      isTrial: pricing.isTrial,
      status: this.formatStatus(subscription.status),
      invoice: latestInvoice?.invoiceNo || undefined,
      autoRenew: subscription.autoRenew,
      createdAt: subscription.createdAt
        ? new Date(subscription.createdAt).toISOString().split('T')[0]
        : 'N/A',
    };
  }

  /**
   * PATCH /api/admin/subscriptions/:id/status
   * Update subscription status
   */
  async updateStatus(
    id: string,
    dto: UpdateSubscriptionStatusDto,
  ): Promise<SubscriptionStatusUpdateResponseDto> {
    // Find subscription by code (SUB-001) or by UUID
    let subscription: Subscription | null = null;

    if (id.startsWith('SUB-')) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { subscriptionCode: id },
      });
    }

    if (!subscription) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { id },
      });
    }

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    // Map DTO status to entity status
    const statusMap: Record<AdminSubscriptionStatusUpdate, SubscriptionStatus> = {
      [AdminSubscriptionStatusUpdate.ACTIVE]: SubscriptionStatus.ACTIVE,
      [AdminSubscriptionStatusUpdate.PENDING]: SubscriptionStatus.PENDING,
      [AdminSubscriptionStatusUpdate.CANCELLED]: SubscriptionStatus.EXPIRED,
      [AdminSubscriptionStatusUpdate.EXPIRED]: SubscriptionStatus.EXPIRED,
    };

    const previousStatus = subscription.status;
    const newStatus = statusMap[dto.status];

    subscription.status = newStatus;
    await this.subscriptionsRepository.save(subscription);

    const displayId = subscription.subscriptionCode || id;

    this.logger.log(
      `Subscription ${displayId} status changed from ${previousStatus} to ${newStatus}`,
    );

    return {
      message: 'Subscription status updated successfully',
      subscriptionId: displayId,
      newStatus: this.formatStatus(newStatus),
    };
  }

  /**
   * Helper: Format status for display
   */
  private formatStatus(status: SubscriptionStatus): string {
    const statusMap: Record<SubscriptionStatus, string> = {
      [SubscriptionStatus.ACTIVE]: 'Active',
      [SubscriptionStatus.TRIAL]: 'Trial',
      [SubscriptionStatus.PENDING]: 'Pending',
      [SubscriptionStatus.EXPIRED]: 'Expired',
      [SubscriptionStatus.CANCELLED]: 'Cancelled',
    };
    return statusMap[status] || status;
  }
}
