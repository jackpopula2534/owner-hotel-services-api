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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrOnboardingService } from './hr-onboarding.service';
import { HrProbationService } from './hr-probation.service';
import {
  SeedOnboardingDto,
  AddOnboardingTaskDto,
  UpdateOnboardingTaskDto,
  CreateProbationReviewDto,
  DecideProbationDto,
} from './dto/hr-lifecycle.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / onboarding')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/onboarding-tasks', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrOnboardingController {
  constructor(private readonly service: HrOnboardingService) {}

  @Get()
  @ApiOperation({ summary: 'Get onboarding checklist for an employee' })
  @ApiQuery({ name: 'employeeId', required: true, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query('employeeId') employeeId: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findByEmployee(employeeId, user.tenantId!);
  }

  @Post('seed')
  @ApiOperation({ summary: 'Seed onboarding checklist (default template or custom)' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async seed(@Body() dto: SeedOnboardingDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.seed(dto, user.tenantId!, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a single onboarding task' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async add(@Body() dto: AddOnboardingTaskDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.addTask(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update / complete an onboarding task' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingTaskDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.updateTask(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an onboarding task' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.removeTask(id, user.tenantId!);
  }
}

@ApiTags('hr / probation')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/probation-reviews', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrProbationController {
  constructor(private readonly service: HrProbationService) {}

  @Get()
  @ApiOperation({ summary: 'List probation reviews' })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'decision', required: false, enum: ['pending', 'passed', 'extended', 'failed'] })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a probation review by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Open a probation review (sets employee → PROBATION)' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(@Body() dto: CreateProbationReviewDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user.tenantId!);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Record a probation decision (passed/extended/failed)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async decide(
    @Param('id') id: string,
    @Body() dto: DecideProbationDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.decide(id, dto, user.id ?? 'system', user.tenantId!);
  }
}
