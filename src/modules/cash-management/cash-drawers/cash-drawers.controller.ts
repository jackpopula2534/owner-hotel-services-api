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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CashDrawersService } from './cash-drawers.service';
import { CreateCashDrawerDto } from './dto/create-cash-drawer.dto';
import { CreateCashTxnDto } from './dto/create-cash-txn.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

class CloseDrawerDto {
  @ApiProperty({ description: 'ยอดเงินที่นับได้จริง', example: 5500 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  countedAmount: number;
}

class TxnQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateTo?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Cash Drawers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/cash-drawers', version: '1' })
export class CashDrawersController {
  constructor(private readonly service: CashDrawersService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการลิ้นชักเงินสดทั้งหมด' })
  @ApiQuery({ name: 'propertyId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.service.findAll(user.tenantId, propertyId, status);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูลิ้นชักเงินสดตาม ID' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างลิ้นชักเงินสด' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCashDrawerDto) {
    const data = await this.service.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Patch(':id/open')
  @ApiOperation({ summary: 'เปิดลิ้นชักเงินสด (เริ่มกะ)' })
  async open(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.open(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'ปิดลิ้นชักเงินสด (สิ้นกะ)' })
  async close(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: CloseDrawerDto,
  ) {
    const data = await this.service.close(id, user.tenantId, user.sub, body.countedAmount);
    return { success: true, data };
  }

  @Post('transactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'เพิ่มรายการเงินสด (RECEIPT / PAYMENT / TRANSFER / ADJUSTMENT)' })
  async addTransaction(@CurrentUser() user: JwtPayload, @Body() dto: CreateCashTxnDto) {
    const data = await this.service.addTransaction(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'ดูประวัติรายการเงินสดของลิ้นชัก' })
  async getTransactions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: TxnQueryDto,
  ) {
    const result = await this.service.getTransactions(id, user.tenantId, query);
    return { success: true, ...result };
  }
}
