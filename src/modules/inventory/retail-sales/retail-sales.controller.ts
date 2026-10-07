import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles, UserRole } from '@/common/decorators/roles.decorator';
import { RetailSalesService } from './retail-sales.service';
import { RetailSaleVoidService } from './retail-sale-void.service';
import { VoidRetailSaleDto } from './dto/void-retail-sale.dto';
import { CreateRetailSaleDto } from './dto/create-retail-sale.dto';
import { QueryRetailSaleDto } from './dto/query-retail-sale.dto';
import { DashboardRetailSaleDto } from './dto/dashboard-retail-sale.dto';

type AuthedReq = { user: { id: string; tenantId: string } };

/** ยกเลิกใบเสร็จ = คืนของ คืนเงิน กลับรายได้ — ผู้จัดการขึ้นไปเท่านั้น แคชเชียร์ยกเลิกเองไม่ได้ */
const VOID_APPROVERS: UserRole[] = ['tenant_admin', 'admin', 'manager', 'warehouse_manager', 'platform_admin'];

@ApiTags('Inventory - Retail Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/retail/sales', version: '1' })
export class RetailSalesController {
  constructor(
    private readonly retailSalesService: RetailSalesService,
    private readonly voidService: RetailSaleVoidService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Checkout a retail/POS sale (deduct stock + record receipt)' })
  @ApiResponse({ status: 201, description: 'Sale recorded' })
  async create(
    @Body() dto: CreateRetailSaleDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.retailSalesService.create(dto, req.user.id, req.user.tenantId);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List retail sales (sales history) with filters' })
  @ApiResponse({ status: 200, description: 'Sales history retrieved' })
  async findAll(
    @Query() query: QueryRetailSaleDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown; meta: unknown; summary: unknown }> {
    const result = await this.retailSalesService.findAll(req.user.tenantId, query);
    return {
      success: true,
      data: result.data,
      meta: result.meta,
      summary: result.summary,
    };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Retail sales dashboard summary (week/month/year)' })
  @ApiResponse({ status: 200, description: 'Dashboard summary retrieved' })
  async dashboard(
    @Query() query: DashboardRetailSaleDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.retailSalesService.getDashboard(req.user.tenantId, query);
    return { success: true, data };
  }

  // ต้องประกาศก่อน @Get(':id') ไม่งั้น 'chargeable-rooms' จะถูกจับเป็น id
  @Get('chargeable-rooms')
  @ApiOperation({ summary: 'Rooms that can take a ROOM_CHARGE right now' })
  @ApiResponse({ status: 200, description: 'In-house rooms retrieved' })
  async chargeableRooms(
    @Query('search') search: string | undefined,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.retailSalesService.listChargeableRooms(req.user.tenantId, search);
    return { success: true, data };
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles(...VOID_APPROVERS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a retail sale (restock goods + gifts, reverse promo, folio and revenue)' })
  @ApiResponse({ status: 200, description: 'Sale voided' })
  async void(
    @Param('id') id: string,
    @Body() dto: VoidRetailSaleDto,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.voidService.void(id, req.user.tenantId, req.user.id, dto.reason);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single retail sale receipt' })
  @ApiResponse({ status: 200, description: 'Sale retrieved' })
  async findOne(
    @Param('id') id: string,
    @Req() req: AuthedReq,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.retailSalesService.findOne(id, req.user.tenantId);
    return { success: true, data };
  }
}
