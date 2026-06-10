import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrSelfServiceService } from './hr-self-service.service';
import { HrAnalyticsService } from './hr-analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / self-service')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/self-service', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrSelfServiceController {
  constructor(private readonly service: HrSelfServiceService) {}

  @Get('me')
  @ApiOperation({ summary: "Self-service overview for the current user's linked employee" })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'staff')
  async me(
    @Query('year') year: string | undefined,
    @CurrentUser() user: { tenantId?: string; employeeId?: string },
  ) {
    return this.service.getOverview(user.employeeId!, user.tenantId!, year ? Number(year) : undefined);
  }

  @Get('employees/:employeeId')
  @ApiOperation({ summary: 'Self-service overview for a specific employee (HR view)' })
  @ApiParam({ name: 'employeeId' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async forEmployee(
    @Param('employeeId') employeeId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.getOverview(employeeId, user.tenantId!, year ? Number(year) : undefined);
  }
}

@ApiTags('hr / analytics')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/analytics', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrAnalyticsController {
  constructor(private readonly service: HrAnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Workforce analytics: headcount, absenteeism, OT cost, turnover' })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async overview(
    @Query('month') month: string | undefined,
    @Query('year') year: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.getOverview(
      user.tenantId!,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
    );
  }
}
