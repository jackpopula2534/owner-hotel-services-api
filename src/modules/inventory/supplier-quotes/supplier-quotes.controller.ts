import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiConsumes,
} from '@nestjs/swagger';
import { SupplierQuotesService } from './supplier-quotes.service';
import { SubmitQuoteDto, QuerySupplierQuoteDto } from './dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Inventory - Supplier Quotes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/supplier-quotes', version: '1' })
export class SupplierQuotesController {
  constructor(private readonly supplierQuotesService: SupplierQuotesService) {}

  // ─── Static / Collection Routes (MUST come before :id) ──────────

  @Get()
  @ApiOperation({
    summary: 'List supplier quotes with pagination and filters',
  })
  @ApiResponse({ status: 200, description: 'Supplier quotes retrieved' })
  async findAll(
    @Query() query: QuerySupplierQuoteDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown; meta: unknown }> {
    const result = await this.supplierQuotesService.findAll(
      user.tenantId,
      query,
    );
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  @Get('by-pr/:prId')
  @ApiOperation({
    summary:
      'Get all supplier quotes for a purchase requisition (for price comparison)',
  })
  @ApiParam({ name: 'prId', description: 'Purchase requisition ID' })
  @ApiResponse({
    status: 200,
    description: 'Supplier quotes for PR retrieved',
  })
  @ApiResponse({ status: 404, description: 'No quotes found' })
  async findByPR(
    @Param('prId') prId: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.findByPR(
      prId,
      user.tenantId,
    );
    return { success: true, data };
  }

  // ─── Specific Sub-routes (:id/action) MUST come before :id ─────

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update supplier quote status manually',
  })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.updateStatus(
      id,
      status,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Patch(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record supplier quote response (REQUESTED → RECEIVED)',
  })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({
    status: 200,
    description: 'Quote submitted and marked as RECEIVED',
  })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 400, description: 'Invalid request or status' })
  async submitQuote(
    @Param('id') id: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.submitQuote(
      id,
      dto,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Select supplier quote as winning quote (RECEIVED → SELECTED)',
  })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({
    status: 200,
    description:
      'Quote selected, other quotes for same PR rejected, PR updated to QUOTES_RECEIVED',
  })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 400, description: 'Invalid status or request' })
  async select(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.selectQuote(
      id,
      user.id,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject supplier quote' })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({ status: 200, description: 'Quote rejected' })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 400, description: 'Invalid status or request' })
  async reject(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.rejectQuote(
      id,
      reason,
      user.tenantId,
    );
    return { success: true, data };
  }

  @Post(':id/upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload attachment file for a supplier quote' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({ status: 200, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(
            process.cwd(),
            'uploads',
            'supplier-quotes',
          );
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const quoteId = req.params.id;
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          cb(null, `quote-${quoteId}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (
          !file.mimetype.match(
            /^(image\/(jpeg|jpg|png|webp)|application\/pdf|application\/vnd\.(ms-excel|openxmlformats-officedocument\.spreadsheetml\.sheet))$/,
          )
        ) {
          return cb(
            new BadRequestException(
              'อนุญาตเฉพาะไฟล์ภาพ (JPG, PNG, WebP), PDF หรือ Excel เท่านั้น',
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: { attachmentUrl: string } }> {
    if (!file) {
      throw new BadRequestException('กรุณาเลือกไฟล์');
    }
    const attachmentUrl = `/uploads/supplier-quotes/${file.filename}`;

    // Update quote with attachment URL
    await this.supplierQuotesService.updateAttachment(
      id,
      attachmentUrl,
      user.tenantId,
    );

    return { success: true, data: { attachmentUrl } };
  }

  // ─── Generic :id Routes (MUST come LAST) ───────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier quote detail with items and supplier' })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({ status: 200, description: 'Supplier quote retrieved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update supplier quote data (edit prices, items, details)',
  })
  @ApiParam({ name: 'id', description: 'Supplier quote ID' })
  @ApiResponse({
    status: 200,
    description: 'Quote updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Quote not found' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async updateQuote(
    @Param('id') id: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() user: { tenantId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.supplierQuotesService.updateQuote(
      id,
      dto,
      user.tenantId,
    );
    return { success: true, data };
  }
}
