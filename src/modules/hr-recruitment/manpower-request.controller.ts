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
import { ManpowerRequestService } from './manpower-request.service';
import { EquipmentRequestService } from './equipment-request.service';
import {
  CreateManpowerRequestDto,
  UpdateManpowerRequestDto,
  SubmitBudgetDto,
  ApprovalDecisionDto,
  CreateEquipmentRequestDto,
  UpdateEquipmentRequestDto,
} from './dto/recruitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

@ApiTags('hr / recruitment — manpower requests')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/manpower-requests', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class ManpowerRequestController {
  constructor(
    private readonly service: ManpowerRequestService,
    private readonly equipmentService: EquipmentRequestService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manpower requests' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a manpower request with full pipeline timeline' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manpower request (draft)' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(@Body() dto: CreateManpowerRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.tenantId!, user.id!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft/rejected manpower request' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(@Param('id') id: string, @Body() dto: UpdateManpowerRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit for approval (draft/rejected → pending_approval)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user.tenantId!, user.id!);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve the current approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async approve(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject at the current approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async reject(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a manpower request (before hiring)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.tenantId!, user.id!);
  }

  // ── Stage 2: budget ────────────────────────────────────────────────────────

  @Post(':id/budget')
  @ApiOperation({ summary: 'Submit budget for approval (budget_pending)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async submitBudget(@Param('id') id: string, @Body() dto: SubmitBudgetDto, @CurrentUser() user: AuthUser) {
    return this.service.submitBudget(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/budget/approve')
  @ApiOperation({ summary: 'Approve the current budget approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async approveBudget(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.approveBudget(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/budget/reject')
  @ApiOperation({ summary: 'Reject the budget (requester revises and resubmits)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async rejectBudget(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: AuthUser) {
    return this.service.rejectBudget(id, dto, user.tenantId!, user.id!);
  }

  // ── Stage 3: equipment ─────────────────────────────────────────────────────

  @Post(':id/equipment')
  @ApiOperation({ summary: 'Request equipment for this manpower request' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async createEquipment(@Param('id') id: string, @Body() dto: CreateEquipmentRequestDto, @CurrentUser() user: AuthUser) {
    return this.equipmentService.create(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — equipment requests')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/equipment-requests', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class EquipmentRequestController {
  constructor(private readonly service: EquipmentRequestService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get an equipment request (+stock availability & linked PR when inventory addon active)' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOneWithAvailability(id, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a pending equipment request (prevents duplicate requests before approval)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(@Param('id') id: string, @Body() dto: UpdateEquipmentRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve the current equipment approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async approve(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.approve(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject the equipment request' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async reject(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: { tenantId?: string; id?: string }) {
    return this.service.reject(id, dto, user.tenantId!, user.id!);
  }
}
