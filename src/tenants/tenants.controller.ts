import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelListQueryDto } from './dto/hotel-list-response.dto';

@Controller('tenants')
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
  createHotel(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelManagementService.createHotel(createHotelDto);
  }

  /**
   * ดึงรายการโรงแรมทั้งหมด (สำหรับหน้าจัดการโรงแรม)
   * รองรับ search, filter, pagination
   */
  @Get('hotels')
  getHotelList(@Query() query: HotelListQueryDto) {
    return this.hotelManagementService.getHotelList(query);
  }

  /**
   * ดึงข้อมูลรายละเอียดโรงแรมแบบครบถ้วน (Professional UX/UI)
   * ใช้เมื่อกดปุ่ม "ดูรายละเอียด"
   * รวมข้อมูล: status, subscription, plan, features, invoices, alerts, permissions
   */
  @Get('hotels/:id')
  getHotelDetail(@Param('id') id: string) {
    return this.hotelDetailService.getHotelDetail(id);
  }

  // ===== LEGACY ENDPOINTS =====

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  /**
   * @deprecated Use GET /tenants/hotels/:id instead
   */
  @Get(':id/detail')
  getHotelDetailLegacy(@Param('id') id: string) {
    return this.hotelDetailService.getHotelDetail(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(id, updateTenantDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }
}


