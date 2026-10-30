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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { NightAuditService } from './night-audit.service';
import { RunNightAuditDto } from './dto/run-night-audit.dto';
import { CloseNightAuditDto } from './dto/close-night-audit.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import {
  ACCOUNTING_CLOSE_ROLES,
  ACCOUNTING_WRITE_ROLES,
  AccountingAccess,
} from '@/modules/accounting/accounting-access.decorator';

class NightAuditQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Night Audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard, RolesGuard)
@AccountingAccess(ACCOUNTING_WRITE_ROLES)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/night-audit', version: '1' })
export class NightAuditController {
  constructor(private readonly service: NightAuditService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการ Night Audit ทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: NightAuditQueryDto) {
    const { propertyId, ...rest } = query;
    const result = await this.service.findAll(user.tenantId, propertyId, rest);
    return { success: true, ...result };
  }

  @Get('pre-check')
  @ApiOperation({
    summary: 'ตรวจความพร้อมก่อนรัน Night Audit (ลิ้นชัก, ห้องค้างเช็คเอาต์, No-show)',
  })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'YYYY-MM-DD (ค่าเริ่มต้น = วันนี้ตามเวลาไทย)',
  })
  async preCheck(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('date') date?: string,
  ) {
    const data = await this.service.preCheck(user.tenantId, propertyId, date);
    return { success: true, data };
  }

  @Get(':id/journal-preview')
  @ApiOperation({ summary: 'ร่าง Journal Entry ของ Night Audit (สรุปรายได้แยกบัญชี + VAT)' })
  async journalPreview(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.journalPreview(id, user.tenantId);
    return { success: true, data };
  }

  @Get('date/:date')
  @ApiOperation({ summary: 'ดู Night Audit ตามวันที่ (YYYY-MM-DD)' })
  @ApiQuery({ name: 'propertyId', required: true })
  async findByDate(
    @CurrentUser() user: JwtPayload,
    @Param('date') date: string,
    @Query('propertyId') propertyId: string,
  ) {
    const data = await this.service.findByDate(user.tenantId, propertyId, date);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู Night Audit ตาม ID' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post('run')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'รัน Night Audit (สร้าง room charges สำหรับวันนั้น)' })
  @ApiResponse({ status: 201, description: 'Night audit completed successfully' })
  async run(@CurrentUser() user: JwtPayload, @Body() dto: RunNightAuditDto) {
    const data = await this.service.run(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Roles(...ACCOUNTING_CLOSE_ROLES)
  @Patch(':id/close')
  @ApiOperation({
    summary:
      'ปิด Night Audit (COMPLETED → CLOSED) และสร้าง Journal Entry รายได้ประจำวัน (NIGHT_AUDIT)',
  })
  async close(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CloseNightAuditDto,
  ) {
    const data = await this.service.close(id, user.tenantId, user.sub, dto);
    return { success: true, data };
  }
}
