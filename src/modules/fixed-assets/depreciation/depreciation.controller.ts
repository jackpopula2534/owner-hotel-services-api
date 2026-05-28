import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DepreciationService } from './depreciation.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

class RunDepreciationDto {
  @ApiProperty() @IsNotEmpty() @IsUUID() propertyId: string;
  @ApiProperty({ description: 'งวด เช่น 2025-01', example: '2025-01' }) @IsNotEmpty() @IsString() period: string;
}

class PostDepreciationDto {
  @ApiProperty({ description: 'งวด เช่น 2025-01' }) @IsNotEmpty() @IsString() period: string;
}

interface JwtPayload { sub: string; tenantId: string; email: string; role: string; }

@ApiTags('Accounting - Depreciation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/depreciation', version: '1' })
export class DepreciationController {
  constructor(private readonly service: DepreciationService) {}

  @Post('run')
  @ApiOperation({ summary: 'รันค่าเสื่อมราคาประจำเดือน (สร้าง AssetDepreciation records)' })
  async run(@CurrentUser() user: JwtPayload, @Body() dto: RunDepreciationDto) {
    const data = await this.service.runMonthlyDepreciation(user.tenantId, dto.propertyId, dto.period, user.sub);
    return { success: true, data };
  }

  @Post('post')
  @ApiOperation({ summary: 'Post ค่าเสื่อมราคา (mark isPosted = true)' })
  async post(@CurrentUser() user: JwtPayload, @Body() dto: PostDepreciationDto) {
    const data = await this.service.postDepreciation(user.tenantId, dto.period, user.sub);
    return { success: true, data };
  }

  @Get('report')
  @ApiOperation({ summary: 'รายงานค่าเสื่อมราคาประจำงวด' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, description: 'เช่น 2025-01' })
  async getReport(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ) {
    const data = await this.service.getDepreciationReport(user.tenantId, propertyId, period);
    return { success: true, data };
  }
}
