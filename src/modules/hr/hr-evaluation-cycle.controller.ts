import {
  Controller,
  Get,
  Post,
  Patch,
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
import { HrEvaluationCycleService } from './hr-evaluation-cycle.service';
import { CreateEvaluationCycleDto, UpdateEvaluationCycleDto } from './dto/create-evaluation-cycle.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / evaluation-cycles')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/evaluation-cycles', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrEvaluationCycleController {
  constructor(private readonly cycleService: HrEvaluationCycleService) {}

  @Get()
  @ApiOperation({ summary: 'รายการ Evaluation Cycles ทั้งหมด' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed', 'archived'] })
  @ApiQuery({ name: 'period', required: false, type: String })
  @ApiQuery({ name: 'page',   required: false, type: Number })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list of evaluation cycles' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.cycleService.findAll(user.tenantId!, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดู Evaluation Cycle + performances' })
  @ApiParam({ name: 'id', description: 'Cycle ID' })
  @ApiResponse({ status: 200, description: 'Cycle detail with performances' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.cycleService.findOne(id, user.tenantId!);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'สถานะความคืบหน้าของ Cycle (กรอกแล้ว X/Y คน)' })
  @ApiParam({ name: 'id', description: 'Cycle ID' })
  @ApiResponse({ status: 200, description: 'Progress summary by status' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getProgress(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.cycleService.getProgress(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({
    summary: 'เปิดรอบประเมินใหม่ — auto-generate HrPerformance records ให้ทุก employee ที่เลือก',
  })
  @ApiResponse({ status: 201, description: 'Cycle created + performance records generated' })
  @ApiResponse({ status: 400, description: 'Template ไม่มี criteria / ไม่มี employee' })
  @ApiResponse({ status: 409, description: 'มีรอบนี้อยู่แล้ว' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(
    @Body() dto: CreateEvaluationCycleDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.cycleService.create(dto, user.tenantId!, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขข้อมูล Cycle (ชื่อ, วันครบกำหนด, สถานะ)' })
  @ApiParam({ name: 'id', description: 'Cycle ID' })
  @ApiResponse({ status: 200, description: 'Cycle updated' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEvaluationCycleDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.cycleService.update(id, dto, user.tenantId!);
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'ปิดรอบประเมิน (ไม่รับ submit ใหม่)' })
  @ApiParam({ name: 'id', description: 'Cycle ID' })
  @ApiResponse({ status: 200, description: 'Cycle closed' })
  @ApiResponse({ status: 409, description: 'Cycle ไม่ได้อยู่ในสถานะ open' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async close(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.cycleService.close(id, user.tenantId!);
  }
}
