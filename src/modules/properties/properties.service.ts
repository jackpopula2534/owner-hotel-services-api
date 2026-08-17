import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { RevenueSegment, RevenueSourceModule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { toBangkokDate } from '../../common/utils/bangkok-day.util';
import { RevenueFilter, RevenueQueryService } from '../revenue/revenue-query.service';

@Injectable()
export class PropertiesService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
    private readonly revenue: RevenueQueryService,
  ) {}

  private buildWhere(tenantId: string, search?: string, includeDeleted = false) {
    const where: any = { tenantId };
    if (!includeDeleted) {
      where.deletedAt = null;
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { location: { contains: search } },
      ];
    }
    return where;
  }

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, search } = query;
    const skip = (page - 1) * limit;

    const includeDeleted = query.includeDeleted === 'true' || query.includeDeleted === '1';
    const onlyDeleted = query.onlyDeleted === 'true' || query.onlyDeleted === '1';

    const where = this.buildWhere(tenantId, search, includeDeleted || onlyDeleted);
    if (onlyDeleted) {
      where.deletedAt = { not: null };
    }
    if (status) where.status = status;

    const [data, total, roomsCurrent, usersCurrent] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: { rooms: true, bookings: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.property.count({ where }),
      this.prisma.room.count({ where: { tenantId } }),
      this.prisma.userTenant.count({ where: { tenantId } }),
    ]);

    // Build usage object from subscription plan
    const usage = await this.getUsageData(tenantId, total, roomsCurrent, usersCurrent);

    return {
      data,
      total,
      page,
      limit,
      usage,
    };
  }

  private async getUsageData(
    tenantId: string,
    propertyCurrent: number,
    roomsCurrent: number,
    usersCurrent: number,
  ) {
    const subscription = await this.prisma.subscriptions.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ['trial', 'active'] },
      },
      include: {
        plans_subscriptions_plan_idToplans: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!subscription) {
      return {
        current: propertyCurrent,
        max: 1,
        addOns: 0,
        totalLimit: 1,
        roomsCurrent,
        roomsMax: 0,
        usersCurrent,
        usersMax: 0,
      };
    }

    const plan = subscription.plans_subscriptions_plan_idToplans;

    // Check property add-ons
    const propertyAddOns = await this.prisma.subscription_features.findMany({
      where: {
        subscription_id: subscription.id,
        is_active: 1,
        features: { code: 'additional_properties', is_active: 1 },
      },
      include: { features: true },
    });
    const addOns = propertyAddOns.reduce((sum, addon) => sum + (addon.quantity || 0), 0);

    return {
      current: propertyCurrent,
      max: Number(plan.max_properties),
      addOns,
      totalLimit: Number(plan.max_properties) + addOns,
      roomsCurrent,
      roomsMax: Number(plan.max_rooms),
      usersCurrent,
      usersMax: Number(plan.max_users),
    };
  }

  async findOne(id: string, tenantId?: string, includeDeleted = false) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };
    if (!includeDeleted) {
      where.deletedAt = null;
    }

    const property = await this.prisma.property.findFirst({
      where,
      include: {
        _count: {
          select: { rooms: true, bookings: true },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    // Build detailed statistics filtered by tenantId + propertyId
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const roomWhere = { tenantId, propertyId: id };

    // เดือนนี้ถึงวันนี้ตามปฏิทินไทย — ตัวเงินทุกตัวถามจากสมุดรายได้ด้วยช่วงเดียวกัน
    // แปลงจากเวลาจริง ไม่ใช่เที่ยงคืนของเครื่อง — เครื่องที่ไม่ได้ตั้ง TZ ไทยจะเพี้ยนไปหนึ่งวัน
    const todayBkk = toBangkokDate(now);
    const monthToDate: RevenueFilter = {
      tenantId,
      propertyId: id,
      from: `${todayBkk.slice(0, 7)}-01`,
      to: todayBkk,
    };
    // ค่าห้องของโรงแรมหลังนี้เท่านั้น — ไม่ปนร้านอาหาร/ร้านค้าที่ตั้งอยู่ในโรงแรม
    const roomsMonthToDate: RevenueFilter = {
      ...monthToDate,
      sourceModule: RevenueSourceModule.HOTEL,
      segment: RevenueSegment.ROOMS,
    };

    const [
      totalRooms,
      availableRooms,
      occupiedRooms,
      maintenanceRooms,
      cleaningRooms,
      monthlyBookings,
      monthlyRevenue,
      roomsRevenue,
      roomsStays,
      todayCheckIns,
      todayCheckOuts,
      totalUsers,
    ] = await Promise.all([
      this.prisma.room.count({ where: roomWhere }),
      this.prisma.room.count({ where: { ...roomWhere, status: 'available' } }),
      this.prisma.room.count({ where: { ...roomWhere, status: 'occupied' } }),
      this.prisma.room.count({
        where: { ...roomWhere, status: { in: ['maintenance', 'out_of_order'] } },
      }),
      // dirty = รอมอบหมายแม่บ้าน (หลัง checkout), cleaning = กำลังทำอยู่ — ทั้งสองรอทำความสะอาด
      this.prisma.room.count({ where: { ...roomWhere, status: { in: ['cleaning', 'dirty'] } } }),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          createdAt: { gte: firstDayOfMonth },
          status: { not: 'cancelled' },
        },
      }),
      // รายได้ทั้งหมดที่รับรู้ที่โรงแรมหลังนี้เดือนนี้ (ห้อง + ร้านอาหาร + ร้านค้า)
      // ใช้ net (= gross − ส่วนลด) เท่านั้น ตรงกับไทล์ "รายได้วันนี้" ของหน้าภาพรวม
      // VAT กับค่าบริการไม่ใช่รายได้ ถ้าเอา total มาโชว์จะสูงกว่ารายงานรายได้เสมอ
      // เคยบวก grandTotal ของใบจองที่ "สร้าง" เดือนนี้เอง ซึ่งไม่ใช่ทั้งวันที่รับรู้
      // และไม่ใช่ทั้งรายได้ — ใบที่สร้างเดือนนี้เพื่อเข้าพักเดือนหน้าก็ถูกนับไปแล้ว
      this.revenue.totals(monthToDate).then((t) => t.net),
      this.revenue.totals(roomsMonthToDate).then((t) => t.net),
      this.revenue.countDocuments(roomsMonthToDate),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          checkIn: { gte: today, lt: tomorrow },
          status: { in: ['confirmed', 'pending'] },
        },
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          checkOut: { gte: today, lt: tomorrow },
          status: 'checked_in',
        },
      }),
      this.prisma.userTenant.count({ where: { tenantId } }).catch(() => 0),
    ]);

    const roomUsagePercent = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    return {
      ...property,
      statistics: {
        roomCount: totalRooms,
        availableRooms,
        usedRooms: occupiedRooms,
        maintenanceRooms,
        cleaningRooms,
        roomUsagePercent,
        monthlyBookings,
        totalRevenue: monthlyRevenue,
        // ค่าห้องเฉลี่ยต่อการเข้าพักที่รับรู้เดือนนี้ — ตัวตั้งกับตัวหารมาจากชุดเดียวกัน
        // (เดิมหารด้วยจำนวนใบจองที่สร้างเดือนนี้ ซึ่งเป็นคนละกลุ่มกับตัวตั้ง)
        avgDailyRate: roomsStays > 0 ? Math.round(roomsRevenue / roomsStays) : 0,
        totalUsers,
        activeUsers: 0,
        todayCheckIns,
        todayCheckOuts,
      },
    };
  }

  async create(createPropertyDto: CreatePropertyDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check property limit based on subscription plan
    await this.checkPropertyLimit(tenantId);

    // Check for duplicate code within tenant (exclude soft-deleted)
    const existing = await this.prisma.property.findFirst({
      where: {
        tenantId,
        code: createPropertyDto.code,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException(`Property with code ${createPropertyDto.code} already exists`);
    }

    const data: any = { ...createPropertyDto, tenantId };
    return this.prisma.property.create({ data });
  }

  private async checkPropertyLimit(tenantId: string): Promise<void> {
    // Get current property count (exclude soft-deleted)
    const currentPropertyCount = await this.prisma.property.count({
      where: { tenantId, deletedAt: null },
    });

    // Get tenant's active subscription with plan
    const subscription = await this.prisma.subscriptions.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ['trial', 'active'] },
      },
      include: {
        plans_subscriptions_plan_idToplans: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    if (!subscription) {
      throw new BadRequestException(
        'No active subscription found. Please subscribe to a plan first.',
      );
    }

    const plan = subscription.plans_subscriptions_plan_idToplans;
    let maxProperties = plan.max_properties;

    // Check for property add-on features
    const propertyAddOns = await this.prisma.subscription_features.findMany({
      where: {
        subscription_id: subscription.id,
        is_active: 1,
        features: {
          code: 'additional_properties',
          is_active: 1,
        },
      },
      include: {
        features: true,
      },
    });

    // Add quantity from add-ons to max properties
    const addOnProperties = propertyAddOns.reduce((sum, addon) => sum + (addon.quantity || 0), 0);
    maxProperties += addOnProperties;

    // Check if limit is reached
    if (currentPropertyCount >= maxProperties) {
      throw new BadRequestException(
        `Property limit reached. Your current plan allows ${plan.max_properties} ${
          plan.max_properties === 1 ? 'property' : 'properties'
        }${
          addOnProperties > 0 ? ` + ${addOnProperties} from add-ons (total: ${maxProperties})` : ''
        }. Please upgrade your plan or purchase additional property add-ons.`,
      );
    }
  }

  async update(
    id: string,
    updatePropertyDto: UpdatePropertyDto,
    tenantId?: string,
    userId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const oldData = await this.findOne(id, tenantId);

    if (updatePropertyDto.code) {
      const existing = await this.prisma.property.findFirst({
        where: {
          tenantId,
          code: updatePropertyDto.code,
          id: { not: id },
          deletedAt: null,
        },
      });

      if (existing) {
        throw new BadRequestException(
          `Property with code ${updatePropertyDto.code} already exists`,
        );
      }
    }

    // Strip fields not yet in DB schema (pending migration: SC/VAT settings)
    const result = await this.prisma.property.update({
      where: { id },
      data: updatePropertyDto,
    });

    this.auditLogService.logPropertyUpdate(id, oldData, result, userId, tenantId);
    return result;
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const property = await this.findOne(id, tenantId);

    // Soft delete — set deletedAt timestamp instead of hard delete
    return this.prisma.property.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'deleted',
      },
    });
  }

  async restore(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Find including deleted records
    const property = await this.findOne(id, tenantId, true);

    if (!property.deletedAt) {
      throw new BadRequestException('Property is not deleted');
    }

    return this.prisma.property.update({
      where: { id },
      data: {
        deletedAt: null,
        status: 'active',
      },
    });
  }
}
