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
import { HrShiftService } from './hr-shift.service';
import {
  CreateHrShiftAssignmentDto,
  UpdateHrShiftAssignmentDto,
  BulkCreateHrShiftAssignmentDto,
} from './dto/create-hr-shift-assignment.dto';
import {
  CreateHrWorkCalendarDto,
  UpdateHrWorkCalendarDto,
} from './dto/create-hr-work-calendar.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / shift roster')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/shifts', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrShiftController {
  constructor(private readonly shiftService: HrShiftService) {}

  // ─── Work Calendar (declared before :id to avoid route capture) ────────────

  @Get('calendar')
  @ApiOperation({ summary: 'List work calendar entries (holidays / special days)' })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: ['holiday', 'special', 'company_event'] })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findCalendar(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.findCalendar(query, user.tenantId!);
  }

  @Post('calendar')
  @ApiOperation({ summary: 'Create a work calendar entry' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async createCalendarEntry(
    @Body() dto: CreateHrWorkCalendarDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.createCalendarEntry(dto, user.tenantId!);
  }

  @Patch('calendar/:id')
  @ApiOperation({ summary: 'Update a work calendar entry' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateCalendarEntry(
    @Param('id') id: string,
    @Body() dto: UpdateHrWorkCalendarDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.updateCalendarEntry(id, dto, user.tenantId!);
  }

  @Delete('calendar/:id')
  @ApiOperation({ summary: 'Delete a work calendar entry' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async removeCalendarEntry(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.removeCalendarEntry(id, user.tenantId!);
  }

  // ─── Bulk roster ───────────────────────────────────────────────────────────

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk upsert roster entries (publish a week/month)' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async bulkAssign(
    @Body() dto: BulkCreateHrShiftAssignmentDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.shiftService.bulkAssign(dto, user.tenantId!, user.id);
  }

  // ─── Shift Assignments ─────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List shift assignments (roster)' })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'departmentId', required: false, type: String })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'shiftTypeId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAssignments(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.findAssignments(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a shift assignment by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAssignment(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.shiftService.findAssignment(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Assign / upsert a single roster entry' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async assign(
    @Body() dto: CreateHrShiftAssignmentDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.shiftService.assign(dto, user.tenantId!, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a shift assignment' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async updateAssignment(
    @Param('id') id: string,
    @Body() dto: UpdateHrShiftAssignmentDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.shiftService.updateAssignment(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a shift assignment' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async removeAssignment(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.shiftService.removeAssignment(id, user.tenantId!);
  }
}
