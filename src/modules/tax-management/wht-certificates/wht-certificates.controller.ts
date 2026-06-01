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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WhtCertificatesService } from './wht-certificates.service';
import { CreateWhtCertDto } from './dto/create-wht-cert.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsOptional, IsUUID, IsDateString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class QueryWhtCertDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
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

@ApiTags('Accounting - WHT Certificates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/wht-certificates', version: '1' })
export class WhtCertificatesController {
  constructor(private readonly service: WhtCertificatesService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการหนังสือรับรองการหักภาษี ณ ที่จ่าย' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryWhtCertDto) {
    const result = await this.service.findAll(user.tenantId, query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูหนังสือรับรอง WHT รายละเอียด' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างหนังสือรับรองการหักภาษี ณ ที่จ่าย' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWhtCertDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/issue')
  @ApiOperation({ summary: 'ออกหนังสือรับรอง (DRAFT → ISSUED)' })
  async issue(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.issue(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/void')
  @ApiOperation({ summary: 'ยกเลิกหนังสือรับรอง WHT' })
  async void(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.void(id, user.tenantId, user.sub);
    return { success: true, data };
  }
}
