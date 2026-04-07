import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { TenantsService, TenantWithUserRole } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelListQueryDto } from './dto/hotel-list-response.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { InviteUserDto } from './dto/invite-user.dto';

@ApiTags('tenants')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'tenants', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly hotelDetailService: HotelDetailService,
    private readonly hotelManagementService: HotelManagementService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ===== MULTI-TENANT MANAGEMENT ENDPOINTS =====

  /**
   * Create an additional company/tenant for the current user
   * Each company requires its own subscription
   */
  @Post('create-company')
  @Roles('tenant_admin')
  @ApiOperation({ summary: 'Create an additional company/tenant' })
  @ApiResponse({
    status: 201,
    description: 'Company created successfully',
  })
  async createAdditionalTenant(
    @Body() createCompanyDto: CreateCompanyDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    const tenant = await this.tenantsService.createAdditionalTenant(user.userId, createCompanyDto);
    return {
      success: true,
      data: tenant,
      message: 'Company created successfully. Please purchase a subscription to activate it.',
    };
  }

  /**
   * Get all companies/tenants for the current user
   */
  @Get('my-companies')
  @Roles('tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  @ApiOperation({ summary: 'Get all tenants accessible to the current user' })
  @ApiResponse({
    status: 200,
    description: 'List of tenants with user role',
  })
  async getMyCompanies(
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: TenantWithUserRole[]; meta: { total: number } }> {
    const tenants = await this.tenantsService.getUserTenants(user.userId);
    return {
      success: true,
      data: tenants,
      meta: {
        total: tenants.length,
      },
    };
  }

  /**
   * Switch the current user's active tenant
   */
  @Post('switch')
  @Roles('tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  @ApiOperation({ summary: 'Switch the current active tenant' })
  @ApiResponse({
    status: 200,
    description: 'Tenant switched successfully',
  })
  async switchTenant(
    @Body() switchTenantDto: SwitchTenantDto,
    @CurrentUser() user: { userId: string; email: string; role: string },
  ) {
    const result = await this.tenantsService.switchTenant(user.userId, switchTenantDto.tenantId);

    // Generate new JWT tokens with the updated tenantId
    const payload = {
      sub: user.userId,
      email: user.email,
      role: user.role,
      tenantId: switchTenantDto.tenantId,
      isPlatformAdmin: false,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '24h',
    });

    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Store refresh token in database
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.userId,
        expiresAt,
      },
    });

    return {
      success: true,
      data: {
        ...result,
        accessToken,
        refreshToken,
      },
    };
  }

  /**
   * Invite a user to a tenant
   */
  @Post('invite')
  @Roles('tenant_admin', 'admin')
  @ApiOperation({ summary: 'Invite a user to a tenant' })
  @ApiResponse({
    status: 201,
    description: 'User invited successfully',
  })
  async inviteUserToTenant(
    @Body() inviteUserDto: InviteUserDto,
    @CurrentUser() user: { userId: string },
  ) {
    const userTenant = await this.tenantsService.inviteUserToTenant(user.userId, inviteUserDto);
    return {
      success: true,
      data: userTenant,
      message: 'User invited successfully',
    };
  }

  // ===== HOTEL MANAGEMENT ENDPOINTS (Professional UX/UI) =====

  /**
   * สร้างโรงแรมใหม่
   * - Platform Admin: สร้าง Tenant ใหม่ให้ลูกค้าคนใดก็ได้
   * - Tenant Admin (ที่ยังไม่มี tenantId): สร้าง Tenant แรกสำหรับตัวเอง (Trial Registration Flow)
   */
  @Post('hotels')
  @Roles('platform_admin', 'tenant_admin')
  createHotel(
    @Body() createHotelDto: CreateHotelDto,
    @CurrentUser() user: { userId?: string; tenantId?: string; role?: string; email?: string },
  ) {
    // Case 1: tenant_admin ที่มี tenantId แล้ว → เพิ่ม Property ใน Tenant เดิม (ไม่สร้าง Tenant ใหม่)
    if (user?.role === 'tenant_admin' && user?.tenantId) {
      return this.hotelManagementService.addPropertyToTenant(createHotelDto, user.tenantId);
    }

    // Case 2: tenant_admin ที่ยังไม่มี tenantId → สร้าง Tenant ใหม่ + link user
    const userContext =
      user?.role === 'tenant_admin' && !user?.tenantId
        ? { userId: user.userId, userEmail: user.email }
        : undefined;

    // Case 3: platform_admin → สร้าง Tenant ใหม่ให้ลูกค้า
    return this.hotelManagementService.createHotel(createHotelDto, userContext);
  }

  /**
   * ดึงรายการโรงแรม
   * - Platform Admin: เห็น ALL Tenants
   * - Tenant Admin/User: เห็นเฉพาะโรงแรมของตัวเอง
   * รองรับ search, filter, pagination
   */
  @Get('hotels')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  getHotelList(
    @Query() query: HotelListQueryDto,
    @CurrentUser() user: { tenantId?: string; role?: string },
  ) {
    // For platform_admin, return all tenants as hotels
    if (user?.role === 'platform_admin') {
      return this.hotelManagementService.getHotelList(query);
    }

    // For tenant users, list properties under their tenant (1 tenant = N properties)
    const tenantId = user?.tenantId || '00000000-0000-0000-0000-000000000000';
    return this.hotelManagementService.getPropertyListForTenant(query, tenantId);
  }

  /**
   * ดึงข้อมูลรายละเอียดโรงแรมแบบครบถ้วน
   * - Platform Admin: ดูได้ทุกโรงแรม
   * - Tenant Admin/User: ดูได้เฉพาะโรงแรมของตัวเอง
   * รวมข้อมูล: status, subscription, plan, features, invoices, alerts, permissions
   */
  @Get('hotels/:id')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  async getHotelDetail(
    @Param('id') id: string,
    @CurrentUser() user: { userId?: string; tenantId?: string; role?: string },
  ) {
    // For platform-admin users, they can look at any hotel
    if (user?.role === 'platform_admin') {
      return this.hotelDetailService.getHotelDetail(id);
    }

    // Resolve the effective tenantId — frontend passes either:
    //   (a) a tenant ID  directly, OR
    //   (b) a property ID (from /dashboard/hotels/[propertyId]/... URL pattern)
    // We resolve (b) → tenantId by looking up the property table first.
    let resolvedTenantId = id;

    const property = await this.prisma.property.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (property?.tenantId) {
      resolvedTenantId = property.tenantId;
    }

    // Check 1: user.tenantId matches the resolved tenant
    if (user?.tenantId && user.tenantId === resolvedTenantId) {
      return this.hotelDetailService.getHotelDetail(resolvedTenantId);
    }

    // Check 2: Multi-tenant support — user might belong to this tenant via user_tenants table
    if (user?.userId) {
      const userTenant = await this.prisma.userTenant.findFirst({
        where: { userId: user.userId, tenantId: resolvedTenantId },
      });
      if (userTenant) {
        return this.hotelDetailService.getHotelDetail(resolvedTenantId);
      }
    }

    throw new ForbiddenException(
      'คุณไม่มีสิทธิ์เข้าถึงข้อมูลของโรงแรมนี้ (Unauthorized access to this hotel)',
    );
  }

  // ===== LEGACY ENDPOINTS =====

  @Post()
  @Roles('platform_admin')
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  findAll(@CurrentUser() user: { tenantId?: string; role?: string }) {
    // Platform admin เห็นทั้งหมด, คนอื่นเห็นแค่ tenant ตัวเอง
    if (user?.role === 'platform_admin') {
      return this.tenantsService.findAll();
    }
    return this.tenantsService.findAll(user?.tenantId);
  }

  /**
   * @deprecated Use GET /tenants/hotels/:id instead
   */
  @Get(':id/detail')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  getHotelDetailLegacy(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string; role?: string },
  ) {
    // Platform admin ดูได้ทุก tenant, คนอื่นดูได้แค่ tenant ตัวเอง
    if (user?.role !== 'platform_admin' && user?.tenantId !== id) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลของโรงแรมนี้');
    }
    return this.hotelDetailService.getHotelDetail(id);
  }

  @Get(':id')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'receptionist', 'staff', 'user')
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string; role?: string }) {
    // Platform admin ดูได้ทุก tenant, คนอื่นดูได้แค่ tenant ตัวเอง
    if (user?.role !== 'platform_admin' && user?.tenantId !== id) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลของ tenant นี้');
    }
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  @Roles('platform_admin', 'tenant_admin')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(id, updateTenantDto);
  }

  @Delete(':id')
  @Roles('platform_admin')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}
