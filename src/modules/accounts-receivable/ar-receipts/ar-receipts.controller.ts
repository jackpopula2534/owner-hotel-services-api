import { withPaginationMeta } from '@/common/utils/pagination.util';
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ArReceiptAllocationService } from './ar-receipt-allocation.service';
import { AllocateArReceiptDto } from './dto/allocate-ar-receipt.dto';
import { ArReceiptsService } from './ar-receipts.service';
import { CreateArReceiptDto } from './dto/create-ar-receipt.dto';
import { RecordWhtCertificateDto } from './dto/record-wht-certificate.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  IsOptional,
  IsUUID,
  IsDateString,
  IsInt,
  IsIn,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RolesGuard } from '@/common/guards/roles.guard';
import { AR_WRITE_ROLES, AccountingAccess } from '@/modules/accounting/accounting-access.decorator';

class QueryArReceiptDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'CLEARED', 'VOID'] })
  @IsOptional()
  @IsIn(['DRAFT', 'CLEARED', 'VOID'])
  status?: string;
  @ApiPropertyOptional({ description: 'ค้นหาเลขใบเสร็จ / ลูกค้า / อ้างอิง' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - AR Receipts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard, RolesGuard)
@AccountingAccess(AR_WRITE_ROLES)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ar-receipts', version: '1' })
export class ArReceiptsController {
  constructor(
    private readonly service: ArReceiptsService,
    private readonly allocation: ArReceiptAllocationService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'สรุปหน้ารับชำระ: รับเดือนนี้ / ยังไม่จัดสรร (2105) / ลูกหนี้ค้าง-เกินกำหนด / WHT รอ 50 ทวิ',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (ค่าเริ่มต้น = เดือนนี้)' })
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('month') month?: string,
  ) {
    const data = await this.allocation.summary(user.tenantId, propertyId, month);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดใบเสร็จ: การตัดชำระ + JE ทั้งหมด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.allocation.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/allocate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'จัดสรรเงินที่ยังไม่ได้ตัดเข้าใบแจ้งหนี้ (Dr 2105 / Cr 1103|1104)' })
  async allocate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AllocateArReceiptDto,
  ) {
    const data = await this.allocation.allocate(id, dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'ดูรายการ AR Receipt ทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryArReceiptDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return withPaginationMeta(result);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้าง AR Receipt และ Allocate กับ Invoice' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateArReceiptDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/wht-certificate')
  @ApiOperation({ summary: 'บันทึกเลขหนังสือรับรอง 50 ทวิ ของภาษีที่ลูกค้าหัก ณ ที่จ่าย' })
  async recordWhtCertificate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RecordWhtCertificateDto,
  ) {
    const data = await this.service.recordWhtCertificate(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/void')
  @ApiOperation({ summary: 'ยกเลิก Receipt และ Reverse Invoice Payments' })
  async void(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.void(id, user.tenantId, user.sub);
    return { success: true, data };
  }
}
