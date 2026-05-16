import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import {
  AddonTrialRequestService,
  TrialRequestEntity,
} from './addon-trial-request.service';
import { CreateTrialRequestDto } from './dto/create-trial-request.dto';
import { AdminReviewTrialRequestDto } from './dto/admin-review.dto';

// ─── Tenant Endpoints ─────────────────────────────────────────────────────────

@ApiTags('Addon Trial Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('addon-trial-requests')
export class AddonTrialRequestController {
  constructor(private readonly service: AddonTrialRequestService) {}

  /**
   * POST /api/v1/addon-trial-requests
   * Tenant ขอทดลองใช้ add-on
   */
  @ApiOperation({ summary: 'ส่งคำขอทดลองใช้ add-on (Free plan)' })
  @ApiResponse({ status: 201, description: 'คำขอถูกส่งแล้ว' })
  @ApiResponse({ status: 409, description: 'มีคำขอนี้อยู่แล้ว หรือใช้งานอยู่แล้ว' })
  @Post()
  async create(
    @Request() req: { user: { tenantId: string } },
    @Body() dto: CreateTrialRequestDto,
  ): Promise<{ success: true; data: TrialRequestEntity }> {
    const data = await this.service.createRequest(req.user.tenantId, dto);
    return { success: true, data };
  }

  /**
   * GET /api/v1/addon-trial-requests/my
   * Tenant ดูรายการคำขอของตัวเอง
   */
  @ApiOperation({ summary: 'ดูรายการคำขอทดลองใช้ของ tenant นี้' })
  @ApiResponse({ status: 200, description: 'List of trial requests' })
  @Get('my')
  async myRequests(
    @Request() req: { user: { tenantId: string } },
  ): Promise<{ success: true; data: TrialRequestEntity[] }> {
    const data = await this.service.findByTenant(req.user.tenantId);
    return { success: true, data };
  }
}

// ─── Admin Endpoints ──────────────────────────────────────────────────────────

@ApiTags('Addon Trial Requests (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
@Controller('admin/addon-trial-requests')
export class AdminAddonTrialRequestController {
  constructor(private readonly service: AddonTrialRequestService) {}

  /**
   * GET /api/v1/admin/addon-trial-requests
   * Admin ดู request ทั้งหมด
   */
  @ApiOperation({ summary: '[Admin] ดูรายการ trial requests ทั้งหมด' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected', 'expired'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  @Get()
  async findAll(
    @Query('status') status?: 'pending' | 'approved' | 'rejected' | 'expired',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: TrialRequestEntity[]; meta: any }> {
    const result = await this.service.findAll({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, data: result.items, meta: result.meta };
  }

  /**
   * PATCH /api/v1/admin/addon-trial-requests/:id/approve
   * Admin อนุมัติ
   */
  @ApiOperation({ summary: '[Admin] อนุมัติคำขอทดลองใช้' })
  @ApiResponse({ status: 200, description: 'Approved' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 400, description: 'Already reviewed' })
  @Patch(':id/approve')
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req: { user: { id: string } },
    @Body() dto: AdminReviewTrialRequestDto,
  ): Promise<{ success: true; data: TrialRequestEntity }> {
    const data = await this.service.approve(id, req.user.id, dto);
    return { success: true, data };
  }

  /**
   * PATCH /api/v1/admin/addon-trial-requests/:id/reject
   * Admin ปฏิเสธ
   */
  @ApiOperation({ summary: '[Admin] ปฏิเสธคำขอทดลองใช้' })
  @ApiResponse({ status: 200, description: 'Rejected' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Patch(':id/reject')
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() req: { user: { id: string } },
    @Body() dto: AdminReviewTrialRequestDto,
  ): Promise<{ success: true; data: TrialRequestEntity }> {
    const data = await this.service.reject(id, req.user.id, dto);
    return { success: true, data };
  }
}
