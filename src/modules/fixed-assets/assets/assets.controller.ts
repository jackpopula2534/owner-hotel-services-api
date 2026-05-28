import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { QueryAssetDto } from './dto/query-asset.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class DisposeAssetDto {
  @ApiPropertyOptional() @IsDateString() disposalDate: string;
  @ApiPropertyOptional() @IsNumber() @Type(() => Number) disposalAmount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Fixed Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/fixed-assets', version: '1' })
export class AssetsController {
  constructor(private readonly service: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูสินทรัพย์ถาวรทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryAssetDto) {
    const data = await this.service.findAll(user.tenantId, query);
    return { success: true, ...data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดสินทรัพย์' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'บันทึกสินทรัพย์ถาวรใหม่' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAssetDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขข้อมูลสินทรัพย์' })
  async update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: Partial<CreateAssetDto>) {
    const data = await this.service.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/dispose')
  @ApiOperation({ summary: 'จำหน่ายสินทรัพย์' })
  async dispose(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: DisposeAssetDto) {
    const data = await this.service.dispose(id, user.tenantId, user.sub, dto.disposalDate, dto.disposalAmount, dto.reason);
    return { success: true, data };
  }

  @Get(':id/depreciation-schedule')
  @ApiOperation({ summary: 'ตารางค่าเสื่อมราคาทั้งอายุการใช้งาน' })
  async getDepreciationSchedule(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.getDepreciationSchedule(id, user.tenantId);
    return { success: true, data };
  }

  @Post(':id/calculate-depreciation')
  @ApiOperation({ summary: 'คำนวณค่าเสื่อมราคาประจำเดือน (preview)' })
  async calculateDepreciation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.calculateDepreciation(id, user.tenantId);
    return { success: true, data };
  }
}
