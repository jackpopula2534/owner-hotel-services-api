import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Query,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import {
  GoodsReceivesService,
  GoodsReceiveDetail,
  PaginatedResponse,
  CashPurchasePayer,
} from './goods-receives.service';
import { CreateGoodsReceiveDto } from './dto/create-goods-receive.dto';
import {
  CreateCashPurchaseDto,
  CASH_PURCHASE_SLIP_FOLDER,
  CASH_PURCHASE_SLIP_MAX_BYTES,
  CASH_PURCHASE_SLIP_MAX_FILES,
} from './dto/create-cash-purchase.dto';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';
import { StorageService } from '@/common/storage/storage.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

/** รูปร่างไฟล์จาก multer เท่าที่ใช้จริง — เลี่ยงการผูกกับ @types/multer */
interface UploadedSlip {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * สลิปคือหลักฐานให้คนอ่านย้อนหลัง ไม่ใช่ไฟล์ให้ระบบเอาไปประมวลผลต่อ
 * จึงรับเฉพาะสิ่งที่เปิดดูได้ในเบราว์เซอร์ — รูปกับ PDF เท่านั้น
 */
const slipFileFilter = (
  _req: any,
  file: { mimetype: string },
  cb: (err: Error | null, accept: boolean) => void,
): void => {
  if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(file.mimetype) && file.mimetype !== 'application/pdf') {
    return cb(
      new BadRequestException('แนบได้เฉพาะไฟล์รูป (JPG, PNG, WebP, HEIC) หรือ PDF เท่านั้น'),
      false,
    );
  }
  cb(null, true);
};

@ApiTags('Inventory - Goods Receive')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/goods-receives', version: '1' })
export class GoodsReceivesController {
  constructor(
    private readonly goodsReceivesService: GoodsReceivesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all goods receives with pagination and filters',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort field: createdAt, grNumber, warehouseId, itemCount',
  })
  @ApiQuery({ name: 'order', required: false, description: 'asc, desc' })
  @ApiQuery({ name: 'warehouseId', required: false })
  @ApiQuery({ name: 'purchaseOrderId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'DRAFT, RECEIVED, INSPECTED, REJECTED',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of goods receives',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            grNumber: 'GR-202604-0001',
            poNumber: 'PO-202604-0001',
            warehouseName: 'Main Warehouse',
            status: 'RECEIVED',
            itemCount: 3,
            totalReceivedQty: 25,
            totalRejectedQty: 2,
            createdAt: '2026-04-14T10:00:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 10, totalPages: 1 },
      },
    },
  })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryGoodsReceiveDto,
  ): Promise<{ success: boolean } & PaginatedResponse<GoodsReceiveDetail>> {
    const result = await this.goodsReceivesService.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get goods receive details with items' })
  @ApiResponse({
    status: 200,
    description: 'Goods receive detail with all items',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          grNumber: 'GR-202604-0001',
          poNumber: 'PO-202604-0001',
          warehouseName: 'Main Warehouse',
          invoiceNumber: 'INV-2026-001',
          status: 'RECEIVED',
          itemCount: 3,
          totalReceivedQty: 25,
          items: [
            {
              itemId: 'uuid',
              itemName: 'Tomato Fresh',
              itemSku: 'SKU-001',
              receivedQty: 10,
              rejectedQty: 1,
              unitCost: 150.5,
              batchNumber: 'BATCH-2026-001',
              expiryDate: '2026-06-14T00:00:00Z',
            },
          ],
          createdAt: '2026-04-14T10:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Goods receive not found' })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new goods receive and update stock' })
  @ApiResponse({
    status: 201,
    description: 'Goods receive created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid item/warehouse',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict: PO status invalid or stock conflict',
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateGoodsReceiveDto,
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.create(createDto, user.userId, user.tenantId);
    return { success: true, data };
  }

  /**
   * บันทึกซื้อสด — the market run.
   *
   * Deliberately a separate route rather than a flag on POST /goods-receives:
   * this one has its own spend ceiling and its own required provenance, and a
   * caller who has not been through those checks must not be able to produce a
   * receipt labelled CASH_PURCHASE.
   */
  @Post('cash-purchase')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a purchase already made in cash (market run) — no PO, writes stock directly',
  })
  @ApiResponse({ status: 201, description: 'Cash purchase recorded and stock written' })
  @ApiResponse({
    status: 400,
    description: 'Validation error, missing vendor, or amount over the cash-purchase ceiling',
  })
  @ApiResponse({ status: 404, description: 'Warehouse, item, supplier or requisition not found' })
  async createCashPurchase(
    @CurrentUser() user: JwtPayload,
    @Body() createDto: CreateCashPurchaseDto,
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.createCashPurchase(
      createDto,
      user.userId,
      user.tenantId,
    );
    return { success: true, data };
  }

  /**
   * รายชื่อคนที่เลือกเป็น "คนออกเงิน" ได้
   *
   * `paidBy` เป็น user id ไม่ใช่ชื่อ ฟอร์มจึงต้องมีรายชื่อให้เลือก — ก่อนหน้านี้
   * ช่องนี้เป็นกล่องพิมพ์ชื่ออิสระ พิมพ์ชื่อจริงลงไปแล้วโดน `paidBy must be a UUID`
   * ทุกครั้ง คือถามสิ่งที่ตัวเองไม่ยอมรับ
   */
  @Get('cash-purchase/payers')
  @ApiOperation({ summary: 'Users who can be named as having fronted the money for a market run' })
  @ApiResponse({ status: 200, description: 'Active users in this tenant (id + display name)' })
  async listCashPurchasePayers(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ success: boolean; data: CashPurchasePayer[] }> {
    const data = await this.goodsReceivesService.listCashPurchasePayers(user.tenantId);
    return { success: true, data };
  }

  /**
   * อัพโหลดสลิป/รูปหลักฐานของการซื้อสด — ทำก่อน แล้วค่อยส่ง key ไปกับใบซื้อ
   *
   * แยกจาก POST cash-purchase เพราะใบซื้อมี items ซ้อนอยู่ข้างใน ถ้ายัดรวมเป็น
   * multipart ทุกฟิลด์จะกลายเป็น string แล้ว @ValidateNested ใช้ไม่ได้ ต้องมานั่ง
   * JSON.parse + validate เองซึ่งเลี่ยง ValidationPipe ของทั้งระบบไปโดยปริยาย
   *
   * ลำดับ "อัพก่อน–บันทึกทีหลัง" ยังเลือกทิศทางที่พังแล้วปลอดภัยกว่า: อัพไม่ผ่าน
   * ก็ยังไม่มีใบรับของ ส่วนถ้าใบรับของพัง ก็เหลือแค่ไฟล์กำพร้าที่ไม่มีใครเห็น
   * ตรงข้ามกับการมีใบรับของที่อ้างว่ามีสลิปแต่ลิงก์เสีย ซึ่งตรวจสอบย้อนไม่ได้เลย
   */
  @Post('cash-purchase/slips')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('slips', CASH_PURCHASE_SLIP_MAX_FILES, {
      storage: memoryStorage(),
      fileFilter: slipFileFilter,
      limits: { fileSize: CASH_PURCHASE_SLIP_MAX_BYTES, files: CASH_PURCHASE_SLIP_MAX_FILES },
    }),
  )
  @ApiOperation({ summary: 'Upload cash-purchase slip images — returns keys to send with the receipt' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        slips: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: `Up to ${CASH_PURCHASE_SLIP_MAX_FILES} images or PDFs, ${CASH_PURCHASE_SLIP_MAX_BYTES / (1024 * 1024)} MB each`,
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Files stored; storage keys returned' })
  @ApiResponse({ status: 400, description: 'No file sent, unsupported type, or file too large' })
  async uploadCashPurchaseSlips(
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files: UploadedSlip[] | undefined,
  ): Promise<{
    success: boolean;
    data: {
      storageKey: string;
      url: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
    }[];
  }> {
    if (!files?.length) {
      throw new BadRequestException('ไม่พบไฟล์ที่แนบมา');
    }
    if (!user?.tenantId) {
      throw new BadRequestException('Tenant context is required to upload a slip');
    }

    // แยกโฟลเดอร์ตาม tenant เพื่อให้ key ของ tenant อื่นถูกปฏิเสธตั้งแต่ตอนผูกกับใบรับของ
    // (ไม่งั้นคนที่เดาชื่อไฟล์ได้จะเอาสลิปของโรงแรมอื่นมาแปะเป็นหลักฐานของตัวเองได้)
    const saved = await this.storage.saveMany(files, {
      folder: `${CASH_PURCHASE_SLIP_FOLDER}/${user.tenantId}`,
      prefix: 'slip',
    });

    return {
      success: true,
      data: saved.map((file, index) => ({
        storageKey: file.key,
        url: file.url,
        originalName: files[index].originalname,
        mimeType: files[index].mimetype,
        sizeBytes: files[index].size,
      })),
    };
  }

  /**
   * QC ผ่าน — accept the GR. Writes stock, creates lots, updates PO.
   * Allowed only for status DRAFT or INSPECTING.
   */
  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept GR after QC — writes stock, creates lots, updates PO' })
  @ApiResponse({ status: 200, description: 'Goods receive accepted and stock written' })
  @ApiResponse({ status: 409, description: 'Invalid status — must be DRAFT or INSPECTING' })
  async accept(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.accept(id, user.userId, user.tenantId);
    return { success: true, data };
  }

  /**
   * QC ปฏิเสธ — reject the GR. NO stock writes, NO PO updates.
   * Reason ≥5 chars required.
   */
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject GR — no stock written, reason required' })
  @ApiResponse({ status: 200, description: 'Goods receive rejected' })
  @ApiResponse({ status: 400, description: 'Reason missing or too short' })
  @ApiResponse({ status: 409, description: 'Invalid status — must be DRAFT or INSPECTING' })
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.reject(
      id,
      user.userId,
      body.reason,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/inspect')
  @ApiOperation({
    summary: 'Mark goods receive as inspected or rejected',
  })
  @ApiResponse({ status: 200, description: 'Inspection status updated' })
  @ApiResponse({ status: 404, description: 'Goods receive not found' })
  @ApiResponse({
    status: 409,
    description: 'Invalid status transition',
  })
  async inspect(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('status') status: 'INSPECTING' | 'REJECTED',
  ): Promise<{ success: boolean; data: GoodsReceiveDetail }> {
    const data = await this.goodsReceivesService.inspect(id, user.userId, user.tenantId, status);
    return { success: true, data };
  }
}
