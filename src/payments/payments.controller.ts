import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { PaymentsService } from './payments.service';
import { StorageService } from '../common/storage/storage.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { ApprovePaymentDto } from './dto/approve-payment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// ── slip upload: เก็บไฟล์ใน memory แล้วส่งต่อให้ StorageService (local/R2) ──
const slipFileFilter = (
  _req: any,
  file: { mimetype: string },
  cb: (err: any, accept: boolean) => void,
) => {
  if (
    !file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/) &&
    file.mimetype !== 'application/pdf'
  ) {
    return cb(
      new BadRequestException('อนุญาตเฉพาะไฟล์ภาพ (JPG, PNG, WebP) หรือ PDF เท่านั้น'),
      false,
    );
  }
  cb(null, true);
};

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'payments', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storage: StorageService,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // POST /payments — รองรับทั้ง multipart/form-data (slip upload)
  //                  และ application/json (programmatic use)
  // ─────────────────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Create payment with optional slip upload' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['invoiceId', 'method'],
      properties: {
        invoiceId: { type: 'string', description: 'Invoice UUID' },
        method: {
          type: 'string',
          enum: ['transfer', 'qr', 'cash'],
          description: 'Payment method',
        },
        slip: {
          type: 'string',
          format: 'binary',
          description: 'Payment slip image (optional)',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Payment created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Validation error' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  @UseInterceptors(
    FileInterceptor('slip', {
      storage: memoryStorage(),
      fileFilter: slipFileFilter,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    }),
  )
  async create(
    @Body() body: any,
    @UploadedFile()
    slip:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    let slipUrl: string | undefined = body.slipUrl;
    if (slip) {
      const saved = await this.storage.save({
        folder: 'payment-slips',
        file: slip,
        prefix: 'slip',
      });
      slipUrl = saved.path;
    }

    // build DTO from multipart body fields (all values come as strings in FormData)
    const dto: CreatePaymentDto = {
      invoiceId: body.invoiceId,
      method: body.method,
      slipUrl,
      status: body.status,
    };

    if (!dto.invoiceId) {
      throw new BadRequestException('invoiceId is required');
    }
    if (!dto.method) {
      throw new BadRequestException('method is required (transfer | qr | cash)');
    }

    return this.paymentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payments' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.paymentsService.findAll(user?.tenantId);
  }

  @Get('invoice/:invoiceId')
  @ApiOperation({ summary: 'Get payments by invoice ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findByInvoiceId(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.paymentsService.findByInvoiceId(invoiceId, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.paymentsService.findOne(id, user?.tenantId);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  approve(
    @Param('id') id: string,
    @Body() approvePaymentDto: ApprovePaymentDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    // Fall back to the authenticated admin's id when not supplied in the body.
    const adminId = approvePaymentDto.adminId ?? user?.id ?? 'system';
    return this.paymentsService.approvePayment(id, adminId, user?.tenantId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  reject(
    @Param('id') id: string,
    @Body() approvePaymentDto: ApprovePaymentDto,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    const adminId = approvePaymentDto.adminId ?? user?.id ?? 'system';
    return this.paymentsService.rejectPayment(id, adminId, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete payment' })
  @Roles('admin', 'platform_admin', 'tenant_admin')
  remove(@Param('id') id: string) {
    return this.paymentsService.remove(id);
  }
}
