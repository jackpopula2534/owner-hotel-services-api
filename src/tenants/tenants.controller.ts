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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
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
   * สร้างโรงแรมใหม่ (เพิ่มโรงแรมใหม่)
   * ใช้เมื่อกดปุ่ม "+ เพิ่มโรงแรมใหม่"
   */
  @Post('hotels')
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  createHotel(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelManagementService.createHotel(createHotelDto);
  }

  /**
   * ดึงรายการโรงแรมทั้งหมด (สำหรับหน้าจัดการโรงแรม)
   * รองรับ search, filter, pagination
   */
  @Get('hotels')
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  getHotelList(@Query() query: HotelListQueryDto) {
    return this.hotelManagementService.getHotelList(query);
  }

  /**
   * ดึงข้อมูลรายละเอียดโรงแรมแบบครบถ้วน (Professional UX/UI)
   * ใช้เมื่อกดปุ่ม "ดูรายละเอียด"
   * รวมข้อมูล: status, subscription, plan, features, invoices, alerts, permissions
   */
  @Get('hotels/:id')
  @Roles('platform_admin', 'tenant_admin', 'manager', 'receptionist', 'staff', 'user')
  getHotelDetail(@Param('id') id: string) {
    return this.hotelDetailService.getHotelDetail(id);
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


