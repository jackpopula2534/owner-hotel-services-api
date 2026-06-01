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
import { ArReceiptsService } from './ar-receipts.service';
import { CreateArReceiptDto } from './dto/create-ar-receipt.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsOptional, IsUUID, IsDateString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class QueryArReceiptDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
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
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/ar-receipts', version: '1' })
export class ArReceiptsController {
  constructor(private readonly service: ArReceiptsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการ AR Receipt ทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryArReceiptDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้าง AR Receipt และ Allocate กับ Invoice' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateArReceiptDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/void')
  @ApiOperation({ summary: 'ยกเลิก Receipt และ Reverse Invoice Payments' })
  async void(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.void(id, user.tenantId, user.sub);
    return { success: true, data };
  }
}
