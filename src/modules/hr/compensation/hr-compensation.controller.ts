import { AllowSystems } from '../../../common/decorators/allow-systems.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { HrCompensationService } from './hr-compensation.service';
import { AdjustCompensationDto, CancelCompensationChangeDto } from './compensation.dto';

type AuthUser = { tenantId?: string; id?: string; role?: string };

@ApiTags('hr / compensation')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr/compensation-changes', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrCompensationController {
  constructor(private readonly service: HrCompensationService) {}

  @Get()
  @ApiOperation({
    summary: 'Compensation history of an employee (newest effective first) + current values',
  })
  @ApiQuery({ name: 'employeeId', required: true })
  @ApiResponse({
    status: 200,
    description:
      '{ canSeePay, current, changes[] } — amounts null for roles without payroll access',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query('employeeId') employeeId: string, @CurrentUser() user: AuthUser) {
    return this.service.listForEmployee(user.tenantId!, employeeId, user.role);
  }

  @Post()
  @ApiOperation({ summary: 'Adjust compensation (effective date + reason required)' })
  @ApiResponse({
    status: 201,
    description: 'Change recorded (applied now when effective date ≤ today, else scheduled)',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async adjust(@Body() dto: AdjustCompensationDto, @CurrentUser() user: AuthUser) {
    return this.service.adjust(dto, user.tenantId!, user.id ?? 'system');
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a change that has not taken effect yet' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelCompensationChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.cancel(id, dto, user.tenantId!, user.id ?? 'system');
  }
}
