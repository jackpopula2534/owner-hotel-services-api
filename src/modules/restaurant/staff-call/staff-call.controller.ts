import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { StaffCallService } from './staff-call.service';
import { CreateStaffCallDto, CallSourceDto } from './dto/create-staff-call.dto';
import { AcknowledgeCallDto, ResolveCallDto } from './dto/update-staff-call.dto';

@ApiTags('Staff Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'restaurants/:restaurantId/staff-calls', version: '1' })
export class StaffCallController {
  constructor(private readonly staffCallService: StaffCallService) {}

  // ─── Create a call from POS ──────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Create a staff call from POS' })
  @ApiResponse({ status: 201, description: 'Call created' })
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateStaffCallDto,
    @Request() req: { user: { tenantId: string } },
  ) {
    const call = await this.staffCallService.create(req.user.tenantId, restaurantId, {
      ...dto,
      source: dto.source ?? CallSourceDto.POS,
    });
    return { success: true, data: call };
  }

  // ─── List active calls ───────────────────────────────────────────────────────
  @Get('active')
  @ApiOperation({ summary: 'Get active (pending + acknowledged) calls' })
  async getActive(
    @Param('restaurantId') restaurantId: string,
    @Request() req: { user: { tenantId: string } },
  ) {
    const calls = await this.staffCallService.findActive(req.user.tenantId, restaurantId);
    return { success: true, data: calls };
  }

  // ─── List all calls with pagination ──────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List all staff calls with pagination' })
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('includeResolved') includeResolved?: string,
    @Request() req?: { user: { tenantId: string } },
  ) {
    const result = await this.staffCallService.findAll(req.user.tenantId, restaurantId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      includeResolved: includeResolved === 'true',
    });
    return { success: true, ...result };
  }

  // ─── Get call counts ────────────────────────────────────────────────────────
  @Get('counts')
  @ApiOperation({ summary: 'Get staff call counts by status' })
  async getCounts(
    @Param('restaurantId') restaurantId: string,
    @Request() req: { user: { tenantId: string } },
  ) {
    const counts = await this.staffCallService.getCounts(req.user.tenantId, restaurantId);
    return { success: true, data: counts };
  }

  // ─── Acknowledge a call ──────────────────────────────────────────────────────
  @Patch(':callId/acknowledge')
  @ApiOperation({ summary: 'Acknowledge a staff call (on my way)' })
  async acknowledge(
    @Param('restaurantId') restaurantId: string,
    @Param('callId') callId: string,
    @Body() dto: AcknowledgeCallDto,
    @Request() req: { user: { tenantId: string } },
  ) {
    const call = await this.staffCallService.acknowledge(
      req.user.tenantId,
      restaurantId,
      callId,
      dto,
    );
    return { success: true, data: call };
  }

  // ─── Resolve a call ─────────────────────────────────────────────────────────
  @Patch(':callId/resolve')
  @ApiOperation({ summary: 'Resolve a staff call' })
  async resolve(
    @Param('restaurantId') restaurantId: string,
    @Param('callId') callId: string,
    @Body() dto: ResolveCallDto,
    @Request() req: { user: { tenantId: string } },
  ) {
    const call = await this.staffCallService.resolve(req.user.tenantId, restaurantId, callId, dto);
    return { success: true, data: call };
  }

  // ─── Cancel a call ──────────────────────────────────────────────────────────
  @Patch(':callId/cancel')
  @ApiOperation({ summary: 'Cancel a staff call' })
  async cancel(
    @Param('restaurantId') restaurantId: string,
    @Param('callId') callId: string,
    @Request() req: { user: { tenantId: string } },
  ) {
    const call = await this.staffCallService.cancel(req.user.tenantId, restaurantId, callId);
    return { success: true, data: call };
  }

  // ─── Resolve all active calls ───────────────────────────────────────────────
  @Post('resolve-all')
  @ApiOperation({ summary: 'Resolve all active calls for the restaurant' })
  async resolveAll(
    @Param('restaurantId') restaurantId: string,
    @Request() req: { user: { tenantId: string } },
  ) {
    const result = await this.staffCallService.resolveAll(req.user.tenantId, restaurantId);
    return { success: true, data: result };
  }
}
