import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ChangeRequestActor } from './product-change-access';
import { ProductChangeRequestsService } from './product-change-requests.service';
import {
  ItemProcurementSnapshot,
  ProductChangeQueriesService,
} from './product-change-queries.service';
import {
  ProductRequestDetail,
  ProductRequestRow,
  ProductRequestSummary,
} from './product-change-shared';
import { ProcurementFieldDef } from './product-change-fields';
import { DuplicateCandidate } from './product-change-apply.service';
import {
  CreateItemUpdateRequestDto,
  CreateNewItemRequestDto,
  ResubmitRequestDto,
} from './dto/create-product-request.dto';
import {
  ApproveRequestDto,
  CancelRequestDto,
  RejectRequestDto,
  ReviewNoteDto,
} from './dto/review-product-request.dto';
import {
  DuplicateCheckDto,
  QueryProductRequestDto,
  SuggestSkuDto,
} from './dto/query-product-request.dto';

interface AuthUser {
  userId: string;
  tenantId: string;
  role: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

const toActor = (u: AuthUser): ChangeRequestActor => ({
  userId: u.userId,
  tenantId: u.tenantId,
  role: u.role,
});

const ok = <T>(data: T): Envelope<T> => ({ success: true, data });

/**
 * คำขอสร้าง/แก้ไขสินค้า: จัดซื้อส่ง → คลังอนุมัติ/รับทราบ
 *
 * สินค้าสร้างได้จากฝั่งคลังเท่านั้น และข้อมูลที่จัดซื้อเป็นเจ้าของ (ชื่อ, Supplier, ราคา,
 * หน่วยซื้อ ...) ทุกการเปลี่ยนต้องผ่านคลังเสมอ — สิทธิ์ละเอียดเช็คใน service
 */
@ApiTags('Inventory - Product Change Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/product-change-requests', version: '1' })
export class ProductChangeRequestsController {
  constructor(
    private readonly service: ProductChangeRequestsService,
    private readonly queries: ProductChangeQueriesService,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'รายการคำขอสินค้า (กรองสถานะ/ประเภท/ของฉัน/ค้นหา)' })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryProductRequestDto,
  ): Promise<{ success: true; data: ProductRequestRow[]; meta: Record<string, number> }> {
    const result = await this.queries.findAll(toActor(user), query);
    return { success: true, ...result };
  }

  @Get('summary')
  @ApiOperation({ summary: 'ตัวเลขสรุป — รอพิจารณา / สร้างใหม่ / แก้ไข / เกิน SLA' })
  @ApiResponse({ status: 200, description: 'Summary counts' })
  async summary(@CurrentUser() user: AuthUser): Promise<Envelope<ProductRequestSummary>> {
    return ok(await this.queries.summary(toActor(user)));
  }

  @Get('field-catalog')
  @ApiOperation({ summary: 'ฟิลด์ที่จัดซื้อเป็นเจ้าของ และระดับที่คลังต้องทำ (รับทราบ/อนุมัติ)' })
  @ApiResponse({ status: 200, description: 'Field definitions' })
  fieldCatalog(): Envelope<readonly ProcurementFieldDef[]> {
    return ok(this.queries.fieldCatalog());
  }

  @Get('duplicate-check')
  @ApiOperation({ summary: 'หาสินค้าที่อาจซ้ำจากชื่อ/บาร์โค้ด ก่อนส่งคำขอสร้างใหม่' })
  @ApiResponse({ status: 200, description: 'Possible duplicates (max 5)' })
  async duplicateCheck(
    @CurrentUser() user: AuthUser,
    @Query() query: DuplicateCheckDto,
  ): Promise<Envelope<DuplicateCandidate[]>> {
    return ok(await this.queries.duplicateCheck(toActor(user), query.name, query.barcode));
  }

  @Get('suggest-sku')
  @ApiOperation({ summary: 'SKU แนะนำตามรหัสหมวด (ฝั่งคลัง)' })
  @ApiResponse({ status: 200, description: 'Suggested SKU' })
  async suggestSku(
    @CurrentUser() user: AuthUser,
    @Query() query: SuggestSkuDto,
  ): Promise<Envelope<{ sku: string }>> {
    return ok({ sku: await this.queries.suggestSku(toActor(user), query.categoryId) });
  }

  @Get('items/:itemId/snapshot')
  @ApiOperation({ summary: 'ค่าปัจจุบันของข้อมูลจัดซื้อ + คำขอค้าง + ประวัติ ของสินค้าหนึ่งตัว' })
  @ApiResponse({ status: 200, description: 'Item snapshot' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async itemSnapshot(
    @CurrentUser() user: AuthUser,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<Envelope<ItemProcurementSnapshot>> {
    return ok(await this.queries.itemSnapshot(toActor(user), itemId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดคำขอ + ไทม์ไลน์ + ผลกระทบสต๊อก + สิทธิ์ของผู้ใช้' })
  @ApiResponse({ status: 200, description: 'Request detail' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.queries.findOne(toActor(user), id));
  }

  // ─── Procurement ─────────────────────────────────────────────────────────

  @Post('new-items')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'จัดซื้อขอสร้างสินค้าใหม่ (ต้องให้คลังอนุมัติ)' })
  @ApiResponse({ status: 201, description: 'Request submitted' })
  @ApiResponse({ status: 403, description: 'Role cannot submit' })
  async submitNewItem(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateNewItemRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.submitNewItem(toActor(user), dto));
  }

  @Post('item-updates')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'จัดซื้อขอแก้ไขข้อมูลจัดซื้อของสินค้า (คลังรับทราบ/อนุมัติ)' })
  @ApiResponse({ status: 201, description: 'Request submitted' })
  @ApiResponse({ status: 400, description: 'No change / invalid values' })
  @ApiResponse({ status: 409, description: 'Item already has an open update request' })
  async submitItemUpdate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateItemUpdateRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.submitItemUpdate(toActor(user), dto));
  }

  @Post(':id/resubmit')
  @ApiOperation({ summary: 'ส่งคำขอใหม่หลังคลังขอข้อมูลเพิ่ม' })
  @ApiResponse({ status: 200, description: 'Resubmitted' })
  async resubmit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResubmitRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.resubmit(toActor(user), id, dto));
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'ผู้ส่งยกเลิกคำขอที่ยังไม่ถูกตัดสิน' })
  @ApiResponse({ status: 200, description: 'Cancelled' })
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.cancel(toActor(user), id, dto));
  }

  // ─── Warehouse ───────────────────────────────────────────────────────────

  @Post(':id/viewed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'บันทึกว่าคลังเปิดอ่านคำขอแล้ว (ครั้งแรก)' })
  @ApiResponse({ status: 204, description: 'Recorded' })
  async markViewed(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.markViewed(toActor(user), id);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'คลังอนุมัติ/รับทราบ — สร้างใหม่ต้องส่ง warehouseData, แก้ไขเลือก approvedFields ได้',
  })
  @ApiResponse({
    status: 200,
    description: 'Approved (and applied unless effectiveDate is in the future)',
  })
  @ApiResponse({ status: 409, description: 'Not pending / SKU taken' })
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.approve(toActor(user), id, dto));
  }

  @Post(':id/request-info')
  @ApiOperation({ summary: 'คลังขอข้อมูลเพิ่ม — คำขอกลับไปที่จัดซื้อ' })
  @ApiResponse({ status: 200, description: 'Sent back' })
  async requestInfo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewNoteDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.requestInfo(toActor(user), id, dto));
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'คลังปฏิเสธ (ระบุสินค้าที่ซ้ำได้)' })
  @ApiResponse({ status: 200, description: 'Rejected' })
  async reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRequestDto,
  ): Promise<Envelope<ProductRequestDetail>> {
    return ok(await this.service.reject(toActor(user), id, dto));
  }
}
