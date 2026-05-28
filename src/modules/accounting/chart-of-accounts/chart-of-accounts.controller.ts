import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

@ApiTags('Accounting - Chart of Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('ACCOUNTING_MODULE')
@Controller({ path: 'accounting/chart-of-accounts', version: '1' })
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูผังบัญชีทั้งหมด' })
  @ApiResponse({ status: 200, description: 'List of accounts' })
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryAccountDto) {
    const data = await this.service.findAll(user.tenantId, query);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูรายละเอียดบัญชี' })
  @ApiResponse({ status: 200, description: 'Account detail' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const data = await this.service.findOne(id, user.tenantId);
    return { success: true, data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างบัญชีใหม่ในผังบัญชี' })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 409, description: 'Account code already exists' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto) {
    const data = await this.service.create(dto, user.tenantId);
    return { success: true, data };
  }

  @Post('seed-defaults')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างผังบัญชีมาตรฐาน (Thai Hotel USALI)' })
  @ApiResponse({ status: 201, description: 'Default accounts seeded' })
  @ApiResponse({ status: 409, description: 'Accounts already exist' })
  async seedDefaults(@CurrentUser() user: JwtPayload) {
    const data = await this.service.seedDefaults(user.tenantId);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขข้อมูลบัญชี' })
  @ApiResponse({ status: 200, description: 'Account updated' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    const data = await this.service.update(id, dto, user.tenantId);
    return { success: true, data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ปิดการใช้งานบัญชี (soft delete)' })
  @ApiResponse({ status: 204, description: 'Account deactivated' })
  @ApiResponse({ status: 400, description: 'Cannot delete account with transactions' })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.service.remove(id, user.tenantId);
  }
}
