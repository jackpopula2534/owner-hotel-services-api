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
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

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
    private prisma: PrismaService,
  ) {}

  // ===== CREATE HOTEL =====

  /**
   * สร้างโรงแรมใหม่ (เพิ่มโรงแรมใหม่)
   */
  async createHotel(dto: CreateHotelDto): Promise<CreateHotelResponseDto> {
    // 0. Handle roomCount mapping and planCode default
    const effectivePlanCode = dto.planCode || 'M'; // Default to Professional for internal creation
    const effectiveRoomCount = dto.roomCount || dto.rooms || 1;

    // 1. ตรวจสอบ Plan
    const plan = await this.plansRepository.findOne({
      where: { code: effectivePlanCode, isActive: true },
    });

    if (!plan) {
      throw new BadRequestException(`Plan with code "${effectivePlanCode}" not found or inactive`);
    }

    // 2. ตรวจสอบจำนวนห้อง
    if (effectiveRoomCount > plan.maxRooms) {
      throw new BadRequestException(
        `Room count (${effectiveRoomCount}) exceeds plan limit (${plan.maxRooms} rooms for Plan ${plan.code})`,
      );
    }

    // 3. คำนวณวันหมดอายุ trial (14 วัน)
    const trialDays = 14;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

    // 4. สร้าง Tenant (Hotel)
    const tenant = this.tenantsRepository.create({
      name: dto.name,
      nameEn: dto.nameEn,
      propertyType: dto.propertyType,
      location: dto.location,
      roomCount: effectiveRoomCount,
      website: dto.website,
      description: dto.description,
      customerName: dto.customerName,
      taxId: dto.taxId,
      email: dto.email,
      phone: dto.phone,
      address: dto.address,
      district: dto.district,
      province: dto.province,
      postalCode: dto.postalCode,
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

    // 6. สร้าง User admin (tenant_admin) สำหรับโรงแรมนี้
    const defaultPassword = randomBytes(16).toString('hex'); // สร้าง password แบบสุ่ม
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    try {
      await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          firstName: dto.customerName?.split(' ')[0] || 'Admin',
          lastName: dto.customerName?.split(' ').slice(1).join(' ') || '',
          role: 'tenant_admin',
          tenantId: savedTenant.id,
          status: 'active',
        },
      });
      // TODO: ส่ง password reset link ทางอีเมลไปให้ user
    } catch (error) {
      // ถ้า user มีอยู่แล้ว (email ซ้ำ) ให้ update tenantId
      if (error.code === 'P2002') {
        await this.prisma.user.updateMany({
          where: { email: dto.email },
          data: { tenantId: savedTenant.id },
        });
      } else {
        console.error('Failed to create tenant admin user:', error);
      }
    }

    // 7. Return formatted response
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
   * @param query - Query parameters for filtering, pagination, and sorting
   * @param tenantId - Optional: Filter to only show this tenant's data (for non-platform-admin users)
   */
  async getHotelList(query: HotelListQueryDto = {}, tenantId?: string): Promise<HotelListResponseDto> {
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

    // Tenant filter (for non-platform-admin users, show only their tenant)
    if (tenantId) {
      queryBuilder.andWhere('tenant.id = :tenantId', { tenantId });
    }

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
    const summary = await this.getSummaryStats(tenantId);

    // Get filter options
    const filterOptions = await this.getFilterOptions(tenantId);

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

  private async getSummaryStats(tenantId?: string): Promise<HotelSummaryStatsDto> {
    const whereBase = tenantId ? { id: tenantId } : {};
    
    const [total, active, trial, suspended, expired] = await Promise.all([
      this.tenantsRepository.count({ where: whereBase }),
      this.tenantsRepository.count({ where: { ...whereBase, status: TenantStatus.ACTIVE } }),
      this.tenantsRepository.count({ where: { ...whereBase, status: TenantStatus.TRIAL } }),
      this.tenantsRepository.count({ where: { ...whereBase, status: TenantStatus.SUSPENDED } }),
      this.tenantsRepository.count({ where: { ...whereBase, status: TenantStatus.EXPIRED } }),
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

  private async getFilterOptions(tenantId?: string): Promise<HotelFilterOptionsDto> {
    // Get status counts
    const queryBuilder = this.tenantsRepository
      .createQueryBuilder('tenant')
      .select('tenant.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('tenant.status');

    if (tenantId) {
      queryBuilder.andWhere('tenant.id = :tenantId', { tenantId });
    }

    const statusCounts = await queryBuilder.getRawMany();

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
