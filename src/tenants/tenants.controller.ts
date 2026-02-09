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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantsService } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelListQueryDto } from './dto/hotel-list-response.dto';

@ApiTags('tenants')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'tenants', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly hotelDetailService: HotelDetailService,
    private readonly hotelManagementService: HotelManagementService,
  ) {}

  // ===== HOTEL MANAGEMENT ENDPOINTS (Professional UX/UI) =====

  /**
   * สร้างโรงแรมใหม่ (Platform Admin เท่านั้น - สร้าง Tenant ใหม่)
   * ⚠️ User ธรรมดาควรใช้ POST /v1/properties แทน (สร้าง Property ภายใน Tenant)
   */
  @Post('hotels')
  @Roles('platform_admin')
  createHotel(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelManagementService.createHotel(createHotelDto);
  }

  /**
   * ดึงรายการโรงแรม
   * - Platform Admin: เห็น ALL Tenants
   * - Tenant Admin/User: เห็นเฉพาะโรงแรมของตัวเอง
   * รองรับ search, filter, pagination
   */
  @Get('hotels')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist', 'staff', 'user')
  getHotelList(
    @Query() query: HotelListQueryDto,
    @CurrentUser() user: { tenantId?: string; role?: string },
  ) {
    // For platform_admin, return all hotels without tenant filtering
    if (user?.role === 'platform_admin') {
      return this.hotelManagementService.getHotelList(query);
    }

    // For other roles, they MUST be filtered by their own tenantId.
    // If a user doesn't have a tenantId yet (e.g., brand new user), 
    // they should see 0 hotels. Using a dummy UUID for filtering ensures 0 results.
    const tenantIdFilter = user?.tenantId || '00000000-0000-0000-0000-000000000000';
    return this.hotelManagementService.getHotelList(query, tenantIdFilter);
  }

  /**
   * ดึงข้อมูลรายละเอียดโรงแรมแบบครบถ้วน
   * - Platform Admin: ดูได้ทุกโรงแรม
   * - Tenant Admin/User: ดูได้เฉพาะโรงแรมของตัวเอง
   * รวมข้อมูล: status, subscription, plan, features, invoices, alerts, permissions
   */
  @Get('hotels/:id')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist', 'staff', 'user')
  getHotelDetail(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string; role?: string },
  ) {
    // For platform-admin users, they can look at any hotel
    if (user?.role === 'platform_admin') {
      return this.hotelDetailService.getHotelDetail(id);
    }
    
    // For non-platform-admin users, they MUST have a tenantId AND it must match the requested ID
    if (user?.tenantId && user.tenantId === id) {
      return this.hotelDetailService.getHotelDetail(id);
    }
    
    throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลของโรงแรมนี้ (Unauthorized access to this hotel)');
  }

  // ===== LEGACY ENDPOINTS =====

  @Post()
  @Roles('platform_admin')
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  findAll() {
    return this.tenantsService.findAll();
  }

  /**
   * @deprecated Use GET /tenants/hotels/:id instead
   */
  @Get(':id/detail')
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  getHotelDetailLegacy(@Param('id') id: string) {
    return this.hotelDetailService.getHotelDetail(id);
  }

  @Get(':id')
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  findOne(@Param('id') id: string) {
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


