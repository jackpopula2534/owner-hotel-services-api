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

  /**
   * GET /api/admin/subscriptions
   * Get all subscriptions with filtering, search, and pagination
   */
  async findAll(
    query: AdminSubscriptionsQueryDto,
  ): Promise<AdminSubscriptionsListResponseDto> {
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

    // Search by hotel name or subscription code
    if (search) {
      queryBuilder.andWhere(
        '(tenant.name LIKE :search OR subscription.subscriptionCode LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and order
    queryBuilder
      .orderBy('subscription.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const subscriptions = await queryBuilder.getMany();

    // Transform to response format
    const data: AdminSubscriptionListItemDto[] = subscriptions.map((sub) => {
      // Build addons array with name and price
      const subscriptionFeatures = sub.subscriptionFeatures || [];
      const addons = subscriptionFeatures.map((sf) => ({
        name: sf.feature?.name || 'Unknown',
        price: Number(sf.price || 0),
      }));

      // Calculate addon total amount
      const addonAmount = addons.reduce((sum, addon) => sum + addon.price, 0);

      // Calculate total price per month
      const planPrice = Number(sub.plan?.priceMonthly || 0);
      const pricePerMonth = planPrice + addonAmount;

      // Format status for display
      const statusDisplay = this.formatStatus(sub.status);

      // Get previous plan name if exists (for upgrade/downgrade indicator)
      const previousPlanName = sub.previousPlan?.name || undefined;

      return {
        id: sub.id,
        subscriptionCode: sub.subscriptionCode || `SUB-${sub.id.slice(0, 3).toUpperCase()}`,
        hotelName: sub.tenant?.name || 'N/A',
        plan: sub.plan?.name || 'No Plan',
        previousPlan: previousPlanName,
        period: {
          start: sub.startDate
            ? new Date(sub.startDate).toISOString().split('T')[0]
            : 'N/A',
          end: sub.endDate
            ? new Date(sub.endDate).toISOString().split('T')[0]
            : 'N/A',
        },
        addons,
        addonAmount,
        pricePerMonth,
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

    // Build addons list
    const addons: SubscriptionAddonDto[] = (
      subscription.subscriptionFeatures || []
    ).map((sf) => ({
      name: sf.feature?.name || 'Unknown',
      price: Number(sf.price || 0),
    }));

    // Calculate total price
    const planPrice = Number(subscription.plan?.priceMonthly || 0);
    const addonTotal = addons.reduce((sum, a) => sum + a.price, 0);
    const pricePerMonth = planPrice + addonTotal;

    // Get latest invoice
    const latestInvoice = subscription.invoices
      ?.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

    return {
      id: subscription.id,
      subscriptionCode: subscription.subscriptionCode || `SUB-${subscription.id.slice(0, 3).toUpperCase()}`,
      hotelName: subscription.tenant?.name || 'N/A',
      hotelEmail: owner?.email || 'N/A',
      plan: subscription.plan?.name || 'No Plan',
      previousPlan: subscription.previousPlan?.name || undefined,
      addons,
      period: {
        start: subscription.startDate
          ? new Date(subscription.startDate).toISOString().split('T')[0]
          : 'N/A',
        end: subscription.endDate
          ? new Date(subscription.endDate).toISOString().split('T')[0]
          : 'N/A',
      },
      pricePerMonth,
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
