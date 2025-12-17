import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Tenant, TenantStatus } from './entities/tenant.entity';
import { Subscription, SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Plan } from '../plans/entities/plan.entity';
import { CreateHotelDto, CreateHotelResponseDto, BillingCycle } from './dto/create-hotel.dto';
import {
  HotelListResponseDto,
  HotelListItemDto,
  HotelListQueryDto,
  HotelSummaryStatsDto,
  HotelFilterOptionsDto,
  HotelListStatusBadge,
} from './dto/hotel-list-response.dto';

@Injectable()
export class HotelManagementService {
  constructor(
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
  ) {}

  // ===== CREATE HOTEL =====

  /**
   * สร้างโรงแรมใหม่ (เพิ่มโรงแรมใหม่)
   */
  async createHotel(dto: CreateHotelDto): Promise<CreateHotelResponseDto> {
    // 1. ตรวจสอบ Plan
    const plan = await this.plansRepository.findOne({
      where: { code: dto.planCode, isActive: true },
    });

    if (!plan) {
      throw new BadRequestException(`Plan with code "${dto.planCode}" not found or inactive`);
    }

    // 2. ตรวจสอบจำนวนห้อง
    if (dto.roomCount > plan.maxRooms) {
      throw new BadRequestException(
        `Room count (${dto.roomCount}) exceeds plan limit (${plan.maxRooms} rooms for Plan ${plan.code})`,
      );
    }

    // 3. คำนวณวันหมดอายุ trial (14 วัน)
    const trialDays = 14;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    // 4. สร้าง Tenant (Hotel)
    const tenant = this.tenantsRepository.create({
      name: dto.name,
      roomCount: dto.roomCount,
      status: TenantStatus.TRIAL,
      trialEndsAt,
    });

    const savedTenant = await this.tenantsRepository.save(tenant);

    // 5. สร้าง Subscription
    const today = new Date();
    const endDate = new Date(trialEndsAt);

    const subscription = this.subscriptionsRepository.create({
      tenantId: savedTenant.id,
      planId: plan.id,
      status: SubscriptionStatus.TRIAL,
      startDate: today,
      endDate: endDate,
      autoRenew: dto.billingCycle === BillingCycle.YEARLY ? true : false,
    });

    const savedSubscription = await this.subscriptionsRepository.save(subscription);

    // 6. Return formatted response
    return {
      success: true,
      message: `Hotel "${dto.name}" created successfully with ${trialDays}-day trial`,
      messageTh: `สร้างโรงแรม "${dto.name}" สำเร็จ พร้อมทดลองใช้ ${trialDays} วัน`,
      data: {
        hotel: {
          id: savedTenant.id,
          name: savedTenant.name,
          roomCount: savedTenant.roomCount,
          status: savedTenant.status,
          statusTh: this.getStatusLabelTh(savedTenant.status),
        },
        subscription: {
          id: savedSubscription.id,
          planCode: plan.code,
          planName: plan.name,
          status: savedSubscription.status,
          startDate: this.formatDateTh(savedSubscription.startDate),
          endDate: this.formatDateTh(savedSubscription.endDate),
        },
        trial: {
          isInTrial: true,
          trialEndsAt: this.formatDateTh(trialEndsAt),
          daysRemaining: trialDays,
        },
      },
    };
  }

  // ===== LIST HOTELS =====

  /**
   * ดึงรายการโรงแรมทั้งหมด (สำหรับหน้าจัดการโรงแรม)
   */
  async getHotelList(query: HotelListQueryDto = {}): Promise<HotelListResponseDto> {
    const {
      search,
      status = 'all',
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    // Build query
    const queryBuilder = this.tenantsRepository
      .createQueryBuilder('tenant')
      .leftJoinAndSelect('tenant.subscription', 'subscription')
      .leftJoinAndSelect('subscription.plan', 'plan');

    // Search filter
    if (search) {
      queryBuilder.andWhere('tenant.name LIKE :search', { search: `%${search}%` });
    }

    // Status filter
    if (status && status !== 'all') {
      queryBuilder.andWhere('tenant.status = :status', { status });
    }

    // Sorting
    const sortColumn = sortBy === 'name' ? 'tenant.name' :
                       sortBy === 'roomCount' ? 'tenant.roomCount' :
                       sortBy === 'status' ? 'tenant.status' :
                       'tenant.createdAt';
    queryBuilder.orderBy(sortColumn, sortOrder.toUpperCase() as 'ASC' | 'DESC');

    // Get total count
    const totalItems = await queryBuilder.getCount();

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Execute query
    const tenants = await queryBuilder.getMany();

    // Build response
    const hotels: HotelListItemDto[] = tenants.map(tenant => this.mapTenantToListItem(tenant));

    // Get summary stats
    const summary = await this.getSummaryStats();

    // Get filter options
    const filterOptions = await this.getFilterOptions();

    // Calculate pagination
    const totalPages = Math.ceil(totalItems / limit);

    return {
      hotels,
      summary,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filterOptions,
      metadata: {
        fetchedAt: new Date().toISOString(),
        searchQuery: search,
        appliedFilters: {
          status: status !== 'all' ? status : undefined,
        },
      },
    };
  }

  // ===== HELPER METHODS =====

  private mapTenantToListItem(tenant: Tenant): HotelListItemDto {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let daysRemaining = 0;
    if (tenant.trialEndsAt) {
      const trialEnd = new Date(tenant.trialEndsAt);
      trialEnd.setHours(0, 0, 0, 0);
      daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    }

    const planNameTh: Record<string, string> = {
      S: 'แพ็คเกจ S',
      M: 'แพ็คเกจ M',
      L: 'แพ็คเกจ L',
    };

    return {
      id: tenant.id,
      name: tenant.name,
      location: '-', // TODO: Add location field to tenant entity
      status: this.buildStatusBadge(tenant.status),
      roomCount: tenant.roomCount,
      roomCountFormatted: `${tenant.roomCount} ห้อง`,
      customerName: '-', // TODO: Add customer field to tenant entity
      billingCycle: tenant.subscription?.autoRenew ? 'รายปี' : 'รายเดือน',
      billingCycleCode: tenant.subscription?.autoRenew ? 'yearly' : 'monthly',
      plan: tenant.subscription?.plan ? {
        code: tenant.subscription.plan.code,
        name: tenant.subscription.plan.name,
        nameTh: planNameTh[tenant.subscription.plan.code] || tenant.subscription.plan.name,
      } : null,
      trial: {
        isInTrial: tenant.status === TenantStatus.TRIAL,
        daysRemaining,
        daysRemainingText: this.getDaysRemainingText(daysRemaining),
      },
      createdAt: tenant.createdAt?.toISOString?.() || String(tenant.createdAt),
      createdAtFormatted: this.formatDateTh(tenant.createdAt),
      actions: {
        canViewDetail: true,
        canEdit: true,
        canDelete: tenant.status !== TenantStatus.ACTIVE,
        canSuspend: tenant.status === TenantStatus.ACTIVE,
      },
    };
  }

  private buildStatusBadge(status: TenantStatus): HotelListStatusBadge {
    const statusMap: Record<TenantStatus, HotelListStatusBadge> = {
      [TenantStatus.TRIAL]: {
        status: 'trial',
        label: 'Trial',
        labelTh: 'ทดลองใช้',
        color: 'blue',
        bgColor: 'bg-blue-100',
        textColor: 'text-blue-800',
      },
      [TenantStatus.ACTIVE]: {
        status: 'active',
        label: 'Active',
        labelTh: 'ใช้งานอยู่',
        color: 'green',
        bgColor: 'bg-green-100',
        textColor: 'text-green-800',
      },
      [TenantStatus.SUSPENDED]: {
        status: 'suspended',
        label: 'Suspended',
        labelTh: 'ระงับการใช้งาน',
        color: 'red',
        bgColor: 'bg-red-100',
        textColor: 'text-red-800',
      },
      [TenantStatus.EXPIRED]: {
        status: 'expired',
        label: 'Expired',
        labelTh: 'ไม่ใช้งาน',
        color: 'gray',
        bgColor: 'bg-gray-100',
        textColor: 'text-gray-800',
      },
    };

    return statusMap[status];
  }

  private async getSummaryStats(): Promise<HotelSummaryStatsDto> {
    const [total, active, trial, suspended, expired] = await Promise.all([
      this.tenantsRepository.count(),
      this.tenantsRepository.count({ where: { status: TenantStatus.ACTIVE } }),
      this.tenantsRepository.count({ where: { status: TenantStatus.TRIAL } }),
      this.tenantsRepository.count({ where: { status: TenantStatus.SUSPENDED } }),
      this.tenantsRepository.count({ where: { status: TenantStatus.EXPIRED } }),
    ]);

    return {
      totalHotels: total,
      activeHotels: active,
      trialHotels: trial,
      suspendedHotels: suspended,
      expiredHotels: expired,
      totalHotelsFormatted: `${total} โรงแรม`,
      activeHotelsFormatted: `${active} โรงแรม`,
      trialHotelsFormatted: `${trial} โรงแรม`,
    };
  }

  private async getFilterOptions(): Promise<HotelFilterOptionsDto> {
    // Get status counts
    const statusCounts = await this.tenantsRepository
      .createQueryBuilder('tenant')
      .select('tenant.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('tenant.status')
      .getRawMany();

    const statusMap: Record<string, { label: string; labelTh: string }> = {
      trial: { label: 'Trial', labelTh: 'ทดลองใช้' },
      active: { label: 'Active', labelTh: 'ใช้งานอยู่' },
      suspended: { label: 'Suspended', labelTh: 'ระงับการใช้งาน' },
      expired: { label: 'Expired', labelTh: 'ไม่ใช้งาน' },
    };

    // Get plans
    const plans = await this.plansRepository.find({ where: { isActive: true } });
    const planNameTh: Record<string, string> = {
      S: 'แพ็คเกจ S (เล็ก)',
      M: 'แพ็คเกจ M (กลาง)',
      L: 'แพ็คเกจ L (ใหญ่)',
    };

    return {
      statuses: statusCounts.map(s => ({
        value: s.status,
        label: statusMap[s.status]?.label || s.status,
        labelTh: statusMap[s.status]?.labelTh || s.status,
        count: parseInt(s.count),
      })),
      provinces: [], // TODO: Add when location field is added
      plans: plans.map(p => ({
        value: p.code,
        label: p.name,
        labelTh: planNameTh[p.code] || p.name,
        count: 0, // TODO: Count subscriptions per plan
      })),
    };
  }

  private getStatusLabelTh(status: TenantStatus): string {
    const labels: Record<TenantStatus, string> = {
      [TenantStatus.TRIAL]: 'ทดลองใช้',
      [TenantStatus.ACTIVE]: 'ใช้งานอยู่',
      [TenantStatus.SUSPENDED]: 'ระงับการใช้งาน',
      [TenantStatus.EXPIRED]: 'ไม่ใช้งาน',
    };
    return labels[status];
  }

  private formatDateTh(date: Date | string): string {
    if (!date) return '-';

    const d = typeof date === 'string' ? new Date(date) : date;

    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];

    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;

    return `${day} ${month} ${year}`;
  }

  private getDaysRemainingText(days: number): string {
    if (days <= 0) {
      return 'หมดอายุแล้ว';
    } else if (days === 1) {
      return 'เหลือ 1 วัน';
    } else {
      return `เหลือ ${days} วัน`;
    }
  }
}
