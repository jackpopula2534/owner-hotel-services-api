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
import { HrLeaveService } from './hr-leave.service';
import {
  CreateHrLeaveRequestDto,
  UpdateHrLeaveRequestDto,
  RejectLeaveRequestDto,
} from './dto/create-hr-leave-request.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / leave')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/leave', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrLeaveController {
  constructor(private readonly leaveService: HrLeaveService) {}

  // ─── Balance ──────────────────────────────────────────────────────────────

  @Get('balance/:employeeId')
  @ApiOperation({ summary: 'Get leave balance for an employee' })
  @ApiParam({ name: 'employeeId', description: 'Employee ID' })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description: 'Year (defaults to current year)',
  })
  @ApiResponse({ status: 200, description: 'Leave balance per leave type' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getLeaveBalance(
    @Param('employeeId') employeeId: string,
    @Query('year') year: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leaveService.getLeaveBalance(
      employeeId,
      user.tenantId!,
      year ? parseInt(year, 10) : undefined,
    );
  }

  // ─── List & Detail ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all leave requests' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
  })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'leaveTypeId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated leave requests' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leaveService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get leave request by ID' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.leaveService.findOne(id, user.tenantId!);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new leave request' })
  @ApiResponse({ status: 201, description: 'Leave request created' })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(@Body() dto: CreateHrLeaveRequestDto, @CurrentUser() user: { tenantId?: string }) {
    return this.leaveService.create(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a pending leave request' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request updated' })
  @ApiResponse({ status: 400, description: 'Cannot update non-pending request' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrLeaveRequestDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leaveService.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a leave request (pending only)' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request deleted' })
  @ApiResponse({ status: 400, description: 'Cannot delete approved request' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.leaveService.remove(id, user.tenantId!);
  }

  // ─── Workflow ─────────────────────────────────────────────────────────────

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a leave request' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request approved' })
  @ApiResponse({ status: 400, description: 'Request is not pending' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async approve(@Param('id') id: string, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.leaveService.approve(id, user.id ?? 'system', user.tenantId!);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a leave request with reason' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request rejected' })
  @ApiResponse({ status: 400, description: 'Request is not pending' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.leaveService.reject(id, dto, user.id ?? 'system', user.tenantId!);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a leave request' })
  @ApiParam({ name: 'id', description: 'Leave request ID' })
  @ApiResponse({ status: 200, description: 'Leave request cancelled' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async cancel(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.leaveService.cancel(id, user.tenantId!);
  }
}
