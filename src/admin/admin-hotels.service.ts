import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, ILike } from 'typeorm';
import { Tenant, TenantStatus } from '../tenants/entities/tenant.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminHotelsQueryDto,
  AdminHotelsListResponseDto,
  AdminHotelListItemDto,
  AdminHotelsSummaryDto,
  AdminHotelDetailDto,
  UpdateHotelStatusDto,
  HotelStatusUpdateResponseDto,
  SendHotelNotificationDto,
  HotelNotificationResponseDto,
} from './dto/admin-hotels.dto';

@Injectable()
export class AdminHotelsService {
  private readonly logger = new Logger(AdminHotelsService.name);

  constructor(
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    private prismaService: PrismaService,
  ) {}

  /**
   * GET /api/admin/hotels
   * Get all hotels with filtering, search, and pagination
   */
  async findAll(
    query: AdminHotelsQueryDto,
  ): Promise<AdminHotelsListResponseDto> {
    const { status, search, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    // Build query
    const queryBuilder = this.tenantsRepository
      .createQueryBuilder('tenant')
      .leftJoinAndSelect('tenant.subscription', 'subscription')
      .leftJoinAndSelect('subscription.plan', 'plan');

    // Filter by status
    if (status) {
      queryBuilder.andWhere('tenant.status = :status', { status });
    }

    // Search by hotel name
    if (search) {
      queryBuilder.andWhere('tenant.name LIKE :search', {
        search: `%${search}%`,
      });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination and order
    queryBuilder
      .orderBy('tenant.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    const tenants = await queryBuilder.getMany();

    // Get users count and owner info for each tenant
    const data: AdminHotelListItemDto[] = await Promise.all(
      tenants.map(async (tenant) => {
        // Get users count for this tenant
        const usersCount = await this.prismaService.user.count({
          where: { tenantId: tenant.id },
        });

        // Get owner (tenant_admin) for this tenant
        const owner = await this.prismaService.user.findFirst({
          where: {
            tenantId: tenant.id,
            role: 'tenant_admin',
          },
        });

        // Calculate revenue from paid invoices
        const revenue = await this.calculateTenantRevenue(tenant.id);

        return {
          id: tenant.id,
          hotelName: tenant.name,
          ownerName: owner
            ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() ||
              owner.email
            : 'N/A',
          plan: tenant.subscription?.plan?.name || 'No Plan',
          rooms: tenant.roomCount,
          users: usersCount,
          status: tenant.status,
          revenue,
        };
      }),
    );

    return {
      total,
      page,
      limit,
      data,
    };
  }

  /**
   * GET /api/admin/hotels/summary
   * Get hotels summary by status
   */
  async getSummary(): Promise<AdminHotelsSummaryDto> {
    const [total, active, trial, expired, suspended] = await Promise.all([
      this.tenantsRepository.count(),
      this.tenantsRepository.count({ where: { status: TenantStatus.ACTIVE } }),
      this.tenantsRepository.count({ where: { status: TenantStatus.TRIAL } }),
      this.tenantsRepository.count({ where: { status: TenantStatus.EXPIRED } }),
      this.tenantsRepository.count({
        where: { status: TenantStatus.SUSPENDED },
      }),
    ]);

    return {
      total,
      active,
      trial,
      expired,
      suspended,
    };
  }

  /**
   * GET /api/admin/hotels/:id
   * Get hotel detail by ID
   */
  async findOne(id: string): Promise<AdminHotelDetailDto> {
    const tenant = await this.tenantsRepository.findOne({
      where: { id },
      relations: ['subscription', 'subscription.plan'],
    });

    if (!tenant) {
      throw new NotFoundException(`Hotel with ID "${id}" not found`);
    }

    // Get owner (tenant_admin) for this tenant
    const owner = await this.prismaService.user.findFirst({
      where: {
        tenantId: tenant.id,
        role: 'tenant_admin',
      },
    });

    // Get users count for this tenant
    const usersCount = await this.prismaService.user.count({
      where: { tenantId: tenant.id },
    });

    // Calculate revenue from paid invoices
    const revenue = await this.calculateTenantRevenue(tenant.id);

    return {
      id: tenant.id,
      hotelName: tenant.name,
      ownerName: owner
        ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() ||
          owner.email
        : 'N/A',
      email: owner?.email || 'N/A',
      createdAt: tenant.createdAt.toISOString().split('T')[0],
      rooms: tenant.roomCount,
      users: usersCount,
      plan: tenant.subscription?.plan?.name || 'No Plan',
      status: tenant.status,
      revenue,
      subscription: {
        expiresAt: tenant.subscription?.endDate
          ? tenant.subscription.endDate.toISOString().split('T')[0]
          : tenant.trialEndsAt
            ? tenant.trialEndsAt.toISOString().split('T')[0]
            : 'N/A',
      },
    };
  }

  /**
   * PATCH /api/admin/hotels/:id/status
   * Update hotel status (suspend/activate)
   */
  async updateStatus(
    id: string,
    dto: UpdateHotelStatusDto,
  ): Promise<HotelStatusUpdateResponseDto> {
    const tenant = await this.tenantsRepository.findOne({ where: { id } });

    if (!tenant) {
      throw new NotFoundException(`Hotel with ID "${id}" not found`);
    }

    const previousStatus = tenant.status;
    tenant.status = dto.status;
    await this.tenantsRepository.save(tenant);

    this.logger.log(
      `Hotel ${id} status changed from ${previousStatus} to ${dto.status}`,
    );

    return {
      success: true,
      message: `Hotel status updated from ${previousStatus} to ${dto.status}`,
      newStatus: dto.status,
    };
  }

  /**
   * POST /api/admin/hotels/:id/notify
   * Send notification email to hotel owner
   */
  async sendNotification(
    id: string,
    dto: SendHotelNotificationDto,
  ): Promise<HotelNotificationResponseDto> {
    const tenant = await this.tenantsRepository.findOne({ where: { id } });

    if (!tenant) {
      throw new NotFoundException(`Hotel with ID "${id}" not found`);
    }

    // Get owner email
    const owner = await this.prismaService.user.findFirst({
      where: {
        tenantId: tenant.id,
        role: 'tenant_admin',
      },
    });

    if (!owner) {
      throw new NotFoundException(
        `Owner for hotel with ID "${id}" not found`,
      );
    }

    // In a real implementation, you would integrate with an email service here
    // For now, we'll just log the notification
    this.logger.log(
      `[EMAIL NOTIFICATION] Type: ${dto.type}, To: ${owner.email}, Hotel: ${tenant.name}`,
    );

    if (dto.message) {
      this.logger.log(`[EMAIL NOTIFICATION] Custom message: ${dto.message}`);
    }

    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    // await this.emailService.send({
    //   to: owner.email,
    //   type: dto.type,
    //   data: { hotelName: tenant.name, customMessage: dto.message }
    // });

    return {
      success: true,
      message: `Notification of type "${dto.type}" sent to ${owner.email}`,
      notificationType: dto.type,
    };
  }

  /**
   * Helper: Calculate total revenue for a tenant from paid invoices
   */
  private async calculateTenantRevenue(tenantId: string): Promise<number> {
    const result = await this.invoicesRepository
      .createQueryBuilder('invoice')
      .select('SUM(invoice.amount)', 'total')
      .where('invoice.tenantId = :tenantId', { tenantId })
      .andWhere('invoice.status = :status', { status: InvoiceStatus.PAID })
      .getRawOne();

    return Number(result?.total) || 0;
  }
}
