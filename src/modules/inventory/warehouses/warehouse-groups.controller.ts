import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { Roles, UserRole } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { WarehouseGroupsService } from './warehouse-groups.service';
import { CreateWarehouseGroupDto, UpdateWarehouseGroupDto } from './dto/warehouse-group.dto';

/** จัดกลุ่มคลังได้เฉพาะผู้ดูแลคลังขึ้นไป — ทุกคนที่ใช้คลังอ่านได้ */
const GROUP_MANAGERS: UserRole[] = [
  'tenant_admin',
  'admin',
  'manager',
  'warehouse_manager',
  'platform_admin',
];

@ApiTags('Inventory - Warehouse Groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@Controller({ path: 'inventory/warehouse-groups', version: '1' })
export class WarehouseGroupsController {
  constructor(private readonly groups: WarehouseGroupsService) {}

  @Get()
  @ApiOperation({ summary: 'รายการกลุ่มคลัง พร้อมคลังในกลุ่ม' })
  async findAll(@CurrentUser() user: { tenantId: string }) {
    return { success: true, data: await this.groups.findAll(user.tenantId) };
  }

  @Get(':id')
  async findOne(@CurrentUser() user: { tenantId: string }, @Param('id') id: string) {
    return { success: true, data: await this.groups.findOne(id, user.tenantId) };
  }

  @Post()
  @Roles(...GROUP_MANAGERS)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'สร้างกลุ่มคลัง + กำหนดคลังในกลุ่ม' })
  async create(@CurrentUser() user: { tenantId: string }, @Body() dto: CreateWarehouseGroupDto) {
    return { success: true, data: await this.groups.create(dto, user.tenantId) };
  }

  @Patch(':id')
  @Roles(...GROUP_MANAGERS)
  async update(
    @CurrentUser() user: { tenantId: string },
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseGroupDto,
  ) {
    return { success: true, data: await this.groups.update(id, dto, user.tenantId) };
  }

  @Delete(':id')
  @Roles(...GROUP_MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบกลุ่ม (คลังในกลุ่มกลับเป็นไม่มีกลุ่ม)' })
  async remove(@CurrentUser() user: { tenantId: string }, @Param('id') id: string) {
    await this.groups.remove(id, user.tenantId);
  }
}
