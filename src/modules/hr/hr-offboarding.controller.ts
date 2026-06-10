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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrOffboardingService } from './hr-offboarding.service';
import { CreateHrOffboardingDto, UpdateClearanceDto } from './dto/hr-offboarding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / offboarding')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/offboarding', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrOffboardingController {
  constructor(private readonly service: HrOffboardingService) {}

  @Get()
  @ApiOperation({ summary: 'List offboarding records' })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['initiated', 'clearing', 'completed', 'cancelled'] })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findAll(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an offboarding record by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Initiate offboarding (resignation/termination) + clearance checklist' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(@Body() dto: CreateHrOffboardingDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.create(dto, user.tenantId!, user.id);
  }

  @Patch(':id/clearance')
  @ApiOperation({ summary: 'Update clearance checklist progress' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async updateClearance(
    @Param('id') id: string,
    @Body() dto: UpdateClearanceDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.updateClearance(id, dto, user.tenantId!, user.id);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Complete offboarding — revoke account, unlink staff, finalise status' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 400, description: 'Clearance incomplete' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async complete(@Param('id') id: string, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.complete(id, user.tenantId!, user.id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an offboarding' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.cancel(id, user.tenantId!);
  }
}
