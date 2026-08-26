import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '@/common/storage/storage.service';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import {
  ItemsService,
  ItemWithStock,
  ItemSearchResult,
  ScannedItem,
  StockSummary,
  PaginatedResponse,
} from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
import { SearchItemDto } from './dto/search-item.dto';
import { ScanBarcodeDto } from './dto/scan-barcode.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AllowSystems } from '../../../common/decorators/allow-systems.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  filename: string;
}

@ApiTags('Inventory - Items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/items', version: '1' })
export class ItemsController {
  constructor(
    private readonly itemsService: ItemsService,
    private readonly storage: StorageService,
  ) {}

  // The POS menu-management view (manager/tenant_admin only) lists inventory items to
  // attach them to a recipe. Reading the catalogue is all it needs — the rest of this
  // controller stays closed to POS tokens.
  @AllowSystems('pos')
  @Get()
  @ApiOperation({ summary: 'Get all items with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name or SKU' })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category ID' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'isPerishable', required: false, type: Boolean })
  @ApiQuery({
    name: 'sort',
    required: false,
    description: 'Sort field: createdAt, name, sku, totalStock, updatedAt',
  })
  @ApiQuery({ name: 'order', required: false, description: 'Sort direction: asc, desc' })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of items',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            tenantId: 'uuid',
            sku: 'SKU-001',
            name: 'Tomato Fresh',
            description: 'Fresh red tomatoes',
            categoryId: 'uuid',
            unit: 'KG',
            costMethod: 'WEIGHTED_AVG',
            reorderPoint: 10,
            reorderQty: 50,
            maxStock: 200,
            minStock: 5,
            barcode: '1234567890123',
            brand: 'Fresh Farm Co.',
            imageUrl: 'https://example.com/tomato.jpg',
            isPerishable: true,
            defaultShelfLifeDays: 7,
            isActive: true,
            category: { id: 'uuid', name: 'Vegetables' },
            totalStock: 45,
            lowStock: false,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 100, totalPages: 5 },
      },
    },
  })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryItemDto,
  ): Promise<{ success: boolean } & PaginatedResponse<ItemWithStock>> {
    const result = await this.itemsService.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Get items with low stock (quantity < reorderPoint)' })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Filter by property ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of low stock items',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            sku: 'SKU-001',
            name: 'Tomato Fresh',
            totalStock: 5,
            reorderPoint: 10,
            reorderQty: 50,
          },
        ],
      },
    },
  })
  async getLowStockItems(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
  ) {
    const data = await this.itemsService.getLowStockItems(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get stock summary (total items, value, low stock count, out of stock count)',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    description: 'Filter by property ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock summary',
    schema: {
      example: {
        success: true,
        data: {
          totalItems: 150,
          totalValue: 45000.5,
          lowStockCount: 12,
          outOfStockCount: 3,
        },
      },
    },
  })
  async getStockSummary(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
  ): Promise<{ success: boolean; data: StockSummary }> {
    const data = await this.itemsService.getStockSummary(user.tenantId, propertyId);
    return { success: true, data };
  }

  @Get('search')
  @ApiOperation({
    summary: 'Lightweight typeahead search for dropdowns (min 2 chars)',
    description:
      'Returns up to 50 active items matching the query against name/SKU/barcode. ' +
      'Intended for typeahead inputs (e.g. Goods Receive item picker) where the ' +
      'full paginated list with stock aggregation would be wasteful. Callers ' +
      'should debounce input and require at least 2 characters before firing.',
  })
  @ApiQuery({ name: 'q', required: true, type: String, description: 'Search query (min 2 chars)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'categoryId', required: false, description: 'Filter by category ID' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Default: true' })
  @ApiResponse({
    status: 200,
    description: 'List of matching items (slim shape — no stock join)',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            sku: 'SKU-001',
            name: 'Tomato Fresh',
            unit: 'KG',
            barcode: '1234567890123',
            categoryId: 'uuid',
            category: { id: 'uuid', name: 'Vegetables' },
            imageUrl: null,
            isPerishable: true,
            defaultShelfLifeDays: 7,
            reorderPoint: 10,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'q too short or missing' })
  async search(
    @CurrentUser() user: JwtPayload,
    @Query() query: SearchItemDto,
  ): Promise<{ success: boolean; data: ItemSearchResult[] }> {
    const data = await this.itemsService.searchItems(user.tenantId, query);
    return { success: true, data };
  }

  // ต้องประกาศก่อน `:id` เสมอ ไม่งั้น Nest จะอ่าน "by-barcode" เป็น id แล้วตอบ 404
  @Get('by-barcode')
  @ApiOperation({
    summary: 'ยิงบาร์โค้ดที่หน้าขาย — คืนสินค้าชิ้นเดียวแบบเทียบตรงตัว',
    description:
      'ต่างจาก /search ตรงที่เทียบบาร์โค้ดเท่ากันเป๊ะ และคืนได้ไม่เกินหนึ่งชิ้น ' +
      'เพราะของที่ยิงเข้าตะกร้าไม่มีใครอ่านซ้ำก่อนคิดเงิน ' +
      'ใส่ warehouseId มาด้วยจะได้ยอดคงเหลือของคลังนั้น (หักที่ถูกกันไว้แล้ว) ติดกลับไป',
  })
  @ApiQuery({ name: 'code', required: true, type: String, example: '8850001000011' })
  @ApiQuery({ name: 'warehouseId', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'สินค้าที่ผูกกับบาร์โค้ดนี้',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          sku: 'SKU-001',
          name: 'น้ำดื่ม 600ml',
          unit: 'BOTTLE',
          barcode: '8850001000011',
          imageUrl: null,
          sellingPrice: 20,
          category: { id: 'uuid', name: 'เครื่องดื่ม' },
          stockQuantity: 144,
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'ไม่มีสินค้าที่ผูกกับบาร์โค้ดนี้' })
  @ApiResponse({ status: 409, description: 'บาร์โค้ดซ้ำกันหลายรายการ — ต้องไปแก้ข้อมูลสินค้าก่อน' })
  async scanBarcode(
    @CurrentUser() user: JwtPayload,
    @Query() query: ScanBarcodeDto,
  ): Promise<{ success: boolean; data: ScannedItem }> {
    const data = await this.itemsService.findByBarcode(user.tenantId, query);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get item by ID with full details' })
  @ApiResponse({
    status: 200,
    description: 'Item details with suppliers and warehouse stocks',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh',
          description: 'Fresh red tomatoes',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 10,
          reorderQty: 50,
          maxStock: 200,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          category: { id: 'uuid', name: 'Vegetables', code: 'CAT-VEG-001' },
          itemSuppliers: [
            {
              id: 'uuid',
              itemId: 'uuid',
              supplierId: 'uuid',
              supplier: {
                id: 'uuid',
                name: 'Fresh Farm Supplier',
                contactPerson: 'John Doe',
                phone: '0812345678',
                email: 'john@farm.com',
              },
            },
          ],
          warehouseStocks: [
            {
              id: 'uuid',
              warehouseId: 'uuid',
              itemId: 'uuid',
              quantity: 45,
              avgCost: 50.0,
              totalValue: 2250.0,
              warehouse: { id: 'uuid', name: 'Main Store' },
            },
          ],
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.itemsService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new item' })
  @ApiResponse({
    status: 201,
    description: 'Item created successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh',
          description: 'Fresh red tomatoes',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 10,
          reorderQty: 50,
          maxStock: 200,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T00:00:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or invalid categoryId' })
  @ApiResponse({ status: 409, description: 'Item SKU already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateItemDto) {
    const data = await this.itemsService.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update item' })
  @ApiResponse({
    status: 200,
    description: 'Item updated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          tenantId: 'uuid',
          sku: 'SKU-001',
          name: 'Tomato Fresh - Updated',
          description: 'Fresh red tomatoes from local farm',
          categoryId: 'uuid',
          unit: 'KG',
          costMethod: 'WEIGHTED_AVG',
          reorderPoint: 15,
          reorderQty: 60,
          maxStock: 250,
          minStock: 5,
          barcode: '1234567890123',
          brand: 'Fresh Farm Co.',
          imageUrl: 'https://example.com/tomato.jpg',
          isPerishable: true,
          defaultShelfLifeDays: 7,
          isActive: true,
          createdAt: '2026-04-14T00:00:00Z',
          updatedAt: '2026-04-14T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or invalid categoryId' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'Item SKU already exists' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    const data = await this.itemsService.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/image')
  @ApiOperation({ summary: 'Upload item image from device' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Image uploaded, item.imageUrl updated' })
  @ApiResponse({ status: 400, description: 'Missing or invalid image file' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(
            new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
  ) {
    if (!file) {
      throw new BadRequestException('ไม่พบไฟล์รูปภาพ');
    }
    const saved = await this.storage.save({
      folder: 'inventory',
      file,
      prefix: `item-${id}`,
    });
    const imageUrl = saved.url;
    const data = await this.itemsService.setImageUrl(id, imageUrl, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete item (soft delete)' })
  @ApiResponse({ status: 204, description: 'Item deleted successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.itemsService.remove(id, user.tenantId);
  }
}
