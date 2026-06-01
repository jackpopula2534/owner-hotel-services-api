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
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { QueryJournalEntryDto } from './dto/query-journal-entry.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class ReverseJournalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Journal Entries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/journal-entries', version: '1' })
export class JournalEntriesController {
  constructor(private readonly service: JournalEntriesService) {}

  @Get()
  @ApiOperation({ summary: 'ดูรายการสมุดรายวันทั้งหมด' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryJournalEntryDto) {
    const data = await this.service.findAll(user.tenantId, query);
    return { success: true, ...data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูรายการสมุดรายวันตาม ID' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างรายการสมุดรายวัน (double-entry)' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJournalEntryDto) {
    const data = await this.service.create(dto, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/post')
  @ApiOperation({ summary: 'Post รายการ (DRAFT → POSTED) และอัปเดต Ledger Balance' })
  async post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.post(id, user.tenantId, user.sub);
    return { success: true, data };
  }

  @Patch(':id/reverse')
  @ApiOperation({ summary: 'กลับรายการ (สร้าง reversal entry อัตโนมัติ)' })
  async reverse(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReverseJournalDto,
  ) {
    const data = await this.service.reverse(id, user.tenantId, user.sub, dto.description);
    return { success: true, data };
  }
}
