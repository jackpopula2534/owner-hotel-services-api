import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { MinibarService } from './minibar.service';
import { CreateMinibarConsumptionDto } from './dto/create-minibar-consumption.dto';
import {
  QueryMinibarConsumptionDto,
  QueryMinibarProductsDto,
  QueryMinibarRoomsDto,
} from './dto/query-minibar.dto';

type AuthedReq = { user: { id: string; tenantId: string } };

/**
 * ต้องมี INVENTORY_MODULE เพราะเส้นทางนี้ตัดของออกจากคลังจริง
 * โรงแรมที่ไม่ได้ซื้อคลังยังคิดค่ามินิบาร์ได้ผ่านการเพิ่มรายการในโฟลิโอตรง ๆ
 * (bookings/:id/folio-charges category = 'minibar') ซึ่งไม่แตะสต๊อก
 */
@ApiTags('Inventory - Minibar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/minibar', version: '1' })
export class MinibarController {
  constructor(private readonly minibarService: MinibarService) {}

  @Get('rooms')
  @ApiOperation({ summary: 'ห้องที่ชาร์จค่ามินิบาร์ได้ตอนนี้' })
  @ApiResponse({ status: 200, description: 'Chargeable rooms retrieved' })
  async listRooms(
    @Query() query: QueryMinibarRoomsDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.minibarService.listRooms(req.user.tenantId, query);
    return { success: true, data };
  }

  @Get('products')
  @ApiOperation({ summary: 'สินค้าในตู้มินิบาร์ของสาขา พร้อมยอดคงเหลือและราคา' })
  @ApiResponse({ status: 200, description: 'Minibar products retrieved' })
  async listProducts(
    @Query() query: QueryMinibarProductsDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const result = await this.minibarService.listProducts(req.user.tenantId, query);
    // source ต้องอยู่ "ใน" data — ตัว unwrap ฝั่งหน้าจอจะคืนเฉพาะ data ให้เมื่อไม่มี meta
    // วางไว้ระดับเดียวกับ data คือหายไปเงียบ ๆ แล้วจอไม่รู้ว่ากำลังตัดจากคลังไหน
    return { success: true, data: { source: result.source, items: result.data } };
  }

  @Get('consumption')
  @ApiOperation({ summary: 'ประวัติการหยิบของจากตู้มินิบาร์' })
  @ApiResponse({ status: 200, description: 'Minibar consumption retrieved' })
  async listConsumption(
    @Query() query: QueryMinibarConsumptionDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown; meta: unknown; summary: unknown }> {
    const result = await this.minibarService.listConsumption(req.user.tenantId, query);
    return { success: true, data: result.data, meta: result.meta, summary: result.summary };
  }

  @Post('consumption')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'บันทึกของที่หายจากตู้ → ตัดสต๊อก + ขึ้นค่ามินิบาร์ในบิลห้อง' })
  @ApiResponse({ status: 201, description: 'Minibar consumption recorded' })
  async recordConsumption(
    @Body() dto: CreateMinibarConsumptionDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.minibarService.recordConsumption(dto, req.user.id, req.user.tenantId);
    return { success: true, data };
  }
}
