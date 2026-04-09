import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { HrKpiTemplateService } from './hr-kpi-template.service';
import {
  CreateKpiTemplateDto,
  UpdateKpiTemplateDto,
  CreateKpiTemplateItemDto,
  UpdateKpiTemplateItemDto,
} from './dto/create-kpi-template.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / kpi-templates')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/kpi-templates', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrKpiTemplateController {
  constructor(private readonly kpiTemplateService: HrKpiTemplateService) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'รายการ KPI Templates ทั้งหมด' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'departmentCode', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'List of KPI templates' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู KPI Template + criteria items' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'สร้าง KPI Template พร้อม criteria items (น้ำหนักรวม = 100%)' })
  @ApiResponse({ status: 201, description: 'Template created' })
  @ApiResponse({ status: 400, description: 'น้ำหนักรวมไม่ = 100%' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(
    @Body() dto: CreateKpiTemplateDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.create(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขข้อมูล KPI Template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template updated' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKpiTemplateDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบ KPI Template (ต้องไม่มี Cycle ใช้งานอยู่)' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 200, description: 'Template deleted' })
  @ApiResponse({ status: 409, description: 'มี Cycle ใช้งานอยู่ ลบไม่ได้' })
  @Roles('platform_admin', 'tenant_admin', 'admin')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.remove(id, user.tenantId!);
  }

  // ─── Criteria Items ──────────────────────────────────────────────────────────

  @Post(':id/items')
  @ApiOperation({ summary: 'เพิ่ม KPI criteria item เข้า Template' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiResponse({ status: 201, description: 'Item added' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async addItem(
    @Param('id') templateId: string,
    @Body() dto: CreateKpiTemplateItemDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.addItem(templateId, dto, user.tenantId!);
  }

  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'แก้ไข KPI criteria item' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiParam({ name: 'itemId', description: 'Criteria Item ID' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateItem(
    @Param('id') templateId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateKpiTemplateItemDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.updateItem(templateId, itemId, dto, user.tenantId!);
  }

  @Delete(':id/items/:itemId')
  @ApiOperation({ summary: 'ลบ KPI criteria item' })
  @ApiParam({ name: 'id', description: 'Template ID' })
  @ApiParam({ name: 'itemId', description: 'Criteria Item ID' })
  @ApiResponse({ status: 200, description: 'Item deleted' })
  @ApiResponse({ status: 409, description: 'มีข้อมูลคะแนน ลบไม่ได้' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async removeItem(
    @Param('id') templateId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.kpiTemplateService.removeItem(templateId, itemId, user.tenantId!);
  }
}
