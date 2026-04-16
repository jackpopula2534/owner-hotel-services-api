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
import { HrAttendanceService } from './hr-attendance.service';
import { CheckInDto, CheckOutDto, CreateHrAttendanceDto } from './dto/create-hr-attendance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / attendance')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/attendance', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrAttendanceController {
  constructor(private readonly attendanceService: HrAttendanceService) {}

  // ─── Stats ────────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get attendance summary (counts per status)' })
  @ApiResponse({ status: 200, description: 'Attendance summary' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getSummary(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.attendanceService.getSummary(query, user.tenantId!);
  }

  // ─── List & Detail ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all attendance records' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['present', 'late', 'absent', 'on_leave', 'holiday'],
  })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated attendance records' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.attendanceService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get attendance record by ID' })
  @ApiParam({ name: 'id', description: 'Attendance record ID' })
  @ApiResponse({ status: 200, description: 'Attendance record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.attendanceService.findOne(id, user.tenantId!);
  }

  // ─── Check-in / Check-out ─────────────────────────────────────────────────

  @Post('check-in')
  @ApiOperation({ summary: 'Record employee check-in' })
  @ApiResponse({ status: 201, description: 'Check-in recorded' })
  @ApiResponse({ status: 409, description: 'Already checked in today' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async checkIn(@Body() dto: CheckInDto, @CurrentUser() user: { tenantId?: string }) {
    return this.attendanceService.checkIn(dto, user.tenantId!);
  }

  @Patch(':id/check-out')
  @ApiOperation({ summary: 'Record employee check-out (calculates work & overtime minutes)' })
  @ApiParam({ name: 'id', description: 'Attendance record ID' })
  @ApiResponse({ status: 200, description: 'Check-out recorded with work hours calculated' })
  @ApiResponse({ status: 400, description: 'No check-in or invalid time' })
  @ApiResponse({ status: 409, description: 'Already checked out' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async checkOut(
    @Param('id') id: string,
    @Body() dto: CheckOutDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.attendanceService.checkOut(id, dto, user.tenantId!);
  }

  // ─── Manual CRUD ──────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Manually create attendance record' })
  @ApiResponse({ status: 201, description: 'Attendance record created' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(@Body() dto: CreateHrAttendanceDto, @CurrentUser() user: { tenantId?: string }) {
    return this.attendanceService.create(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update attendance record' })
  @ApiParam({ name: 'id', description: 'Attendance record ID' })
  @ApiResponse({ status: 200, description: 'Attendance record updated' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateHrAttendanceDto>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.attendanceService.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete attendance record' })
  @ApiParam({ name: 'id', description: 'Attendance record ID' })
  @ApiResponse({ status: 200, description: 'Attendance record deleted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.attendanceService.remove(id, user.tenantId!);
  }
}
