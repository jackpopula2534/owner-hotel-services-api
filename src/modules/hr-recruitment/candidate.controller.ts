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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CandidateService } from './candidate.service';
import { InterviewService } from './interview.service';
import { HireService } from './hire.service';
import {
  CreateCandidateDto,
  UpdateCandidateDto,
  ScheduleInterviewDto,
  RescheduleInterviewDto,
  InterviewResultDto,
  MakeOfferDto,
  HireCandidateDto,
  CancelHireDto,
} from './dto/recruitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

@ApiTags('hr / recruitment — candidates')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/candidates', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class CandidateController {
  constructor(
    private readonly service: CandidateService,
    private readonly interviewService: InterviewService,
    private readonly hireService: HireService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List candidates' })
  @ApiQuery({ name: 'manpowerRequestId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a candidate profile (interviews + offer)' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a candidate' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(@Param('id') id: string, @Body() dto: UpdateCandidateDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/interviews')
  @ApiOperation({ summary: 'Schedule an interview for a candidate' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async scheduleInterview(@Param('id') id: string, @Body() dto: ScheduleInterviewDto, @CurrentUser() user: AuthUser) {
    return this.interviewService.schedule(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/offer')
  @ApiOperation({ summary: 'Make an offer (salary + start date/time + probation length)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async makeOffer(@Param('id') id: string, @Body() dto: MakeOfferDto, @CurrentUser() user: AuthUser) {
    return this.service.makeOffer(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/decline-offer')
  @ApiOperation({ summary: 'Candidate declined the offer' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async declineOffer(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.declineOffer(id, user.tenantId!, user.id!);
  }

  @Post(':id/hire')
  @ApiOperation({ summary: 'Offer accepted → create employee + first-day issuance checklist' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async hire(@Param('id') id: string, @Body() dto: HireCandidateDto, @CurrentUser() user: AuthUser) {
    return this.hireService.hire(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — interviews')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/interviews', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class InterviewController {
  constructor(private readonly service: InterviewService) {}

  @Get()
  @ApiOperation({ summary: 'List interviews (calendar view)' })
  @ApiQuery({ name: 'candidateId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an interview' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reschedule / cancel / mark no-show' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async reschedule(@Param('id') id: string, @Body() dto: RescheduleInterviewDto, @CurrentUser() user: AuthUser) {
    return this.service.reschedule(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/result')
  @ApiOperation({ summary: 'Record interview result (pass/fail/next_round)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async recordResult(@Param('id') id: string, @Body() dto: InterviewResultDto, @CurrentUser() user: AuthUser) {
    return this.service.recordResult(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — hire records')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/hire-records', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HireRecordController {
  constructor(private readonly hireService: HireService) {}

  @Post(':id/confirm-start')
  @ApiOperation({ summary: 'First day: employee reported → PROBATION + auto-open probation round' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async confirmStart(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.hireService.confirmStart(id, user.tenantId!, user.id!);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'No-show: cancel an accepted hire → release reservations + reopen recruiting' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(@Param('id') id: string, @Body() dto: CancelHireDto, @CurrentUser() user: AuthUser) {
    return this.hireService.cancelNoShow(id, dto, user.tenantId!, user.id!);
  }
}
