import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { RetailProductsService } from './retail-products.service';
import { QueryRetailProductDto } from './dto/query-retail-product.dto';
import { CreateMenuFromItemDto } from './dto/create-menu-from-item.dto';

type AuthedReq = { user: { id: string; tenantId: string } };

@ApiTags('Inventory - Retail Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/retail/products', version: '1' })
export class RetailProductsController {
  constructor(private readonly retailProductsService: RetailProductsService) {}

  @Get()
  @ApiOperation({ summary: 'สินค้าสำเร็จรูปที่ขายหน้าร้านได้ พร้อมยอดคลัง ต้นทุนเฉลี่ย และกำไรต่อชิ้น' })
  async findAll(@Query() query: QueryRetailProductDto, @Req() req: AuthedReq) {
    const result = await this.retailProductsService.findAll(req.user.tenantId, query);
    return { success: true, data: result.data, meta: result.meta };
  }

  @Get('summary')
  @ApiOperation({ summary: 'สรุปสินค้าหน้าร้าน — ยังไม่ตั้งราคา ยังไม่ผูกเมนู ของหมด ของติดลบ' })
  async summary(@Req() req: AuthedReq) {
    return { success: true, data: await this.retailProductsService.summary(req.user.tenantId) };
  }

  @Post(':id/menu-items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างเมนูขายหน้าร้านจากสินค้าตัวนี้ (ผูก 1:1 ให้อัตโนมัติ)' })
  @ApiParam({ name: 'id', description: 'รหัสสินค้าในคลัง' })
  @ApiResponse({ status: 201, description: 'สร้างเมนูแล้ว' })
  @ApiResponse({ status: 400, description: 'เป็นวัตถุดิบ / ไม่พบหมวดเมนู / ยังไม่มีราคาขาย' })
  @ApiResponse({ status: 409, description: 'ร้านนี้ผูกสินค้าตัวนี้เป็นเมนูไว้แล้ว' })
  async createMenuItem(
    @Param('id') id: string,
    @Body() dto: CreateMenuFromItemDto,
    @Req() req: AuthedReq,
  ) {
    const data = await this.retailProductsService.createMenuItem(req.user.tenantId, id, dto);
    return { success: true, data };
  }
}
