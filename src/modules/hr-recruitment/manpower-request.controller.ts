import { AllowSystems } from '../../common/decorators/allow-systems.decorator';
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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { StorageService } from '../../common/storage/storage.service';
import { attachmentFolder } from './manpower-approval-history';
import { Throttle } from '@nestjs/throttler';
import { ManpowerRequestService } from './manpower-request.service';
import { EquipmentRequestService } from './equipment-request.service';
import { ManpowerInsightsService } from './manpower-insights.service';
import { RecruitmentOverviewService } from './recruitment-overview.service';
import {
  CreateManpowerRequestDto,
  UpdateManpowerRequestDto,
  SubmitBudgetDto,
  ApprovalDecisionDto,
  CreateEquipmentRequestDto,
  UpdateEquipmentRequestDto,
  RequiredNoteDto,
  SubmitManpowerRequestDto,
} from './dto/recruitment.dto';

/** ไฟล์ประกอบการอนุมัติ: รูป, PDF, Word, Excel ไม่เกิน 10MB */
const ATTACHMENT_MIME =
  /^(image\/(jpeg|png|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/vnd\.ms-excel)$/;
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

@ApiTags('hr / recruitment — manpower requests')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr/manpower-requests', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class ManpowerRequestController {
  constructor(
    private readonly service: ManpowerRequestService,
    private readonly equipmentService: EquipmentRequestService,
    private readonly insights: ManpowerInsightsService,
    private readonly overview: RecruitmentOverviewService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manpower requests (+ department + progress funnel per row)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'bucket', required: false, enum: ['active', 'closed', 'all'] })
  @ApiQuery({ name: 'search', required: false, description: 'positionTitle / requestNo contains' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user.tenantId!);
  }

  // ── static GET routes must be declared before ':id' ─────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Dashboard counters for the manpower request list' })
  @ApiResponse({
    status: 200,
    description:
      '{ pendingApproval, budgetPending, recruiting, startingThisMonth, avgTimeToHireDays, active, closed }',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async summary(@CurrentUser() user: AuthUser) {
    return this.insights.summary(user.tenantId!);
  }

  @Get('recruitment-overview')
  @ApiOperation({
    summary:
      'Recruitment overview: open requests (budget approved → offer made) with all their candidates',
  })
  @ApiResponse({ status: 200, description: '{ asOf, requests: [...], candidates: [...] }' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async recruitmentOverview(@CurrentUser() user: AuthUser) {
    return this.overview.getOverview(user.tenantId);
  }

  @Get('insights')
  @ApiOperation({
    summary:
      'Decision support while drafting: time-to-hire, dept headcount/OT/budget, salary band, recent leavers',
  })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'positionId', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getInsights(
    @Query('departmentId') departmentId: string | undefined,
    @Query('positionId') positionId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.insights.insights(user.tenantId!, {
      departmentId: departmentId || undefined,
      positionId: positionId || undefined,
    });
  }

  @Get(':id/probation')
  @ApiOperation({
    summary: 'Probation progress (latest round) of every hired candidate of the request',
  })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async probation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.insights.probation(id, user.tenantId!);
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
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateManpowerRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit for approval (draft/rejected → pending_approval)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async submit(
    @Param('id') id: string,
    @Body() dto: SubmitManpowerRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submit(id, dto ?? {}, user.tenantId!, user.id!);
  }

  @Post(':id/attachments')
  @ApiOperation({
    summary: 'อัปโหลดไฟล์ประกอบการขอ/อนุมัติ (แล้วส่ง metadata ไปกับ submit/approve/return/reject)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
      fileFilter: (_req, file, cb) =>
        ATTACHMENT_MIME.test(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('แนบได้เฉพาะรูปภาพ, PDF, Word หรือ Excel'), false),
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile()
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์');
    await this.service.findOne(id, user.tenantId!); // 404 ถ้าไม่ใช่คำขอของ tenant นี้
    const saved = await this.storage.save({
      folder: attachmentFolder(user.tenantId!, id),
      file,
      prefix: 'att',
    });
    // multer อ่านชื่อไฟล์เป็น latin1 — แปลงกลับเป็น utf8 ให้ชื่อไทยไม่เพี้ยน
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 255);
    return { name, url: saved.path, key: saved.key, size: file.size, mimeType: file.mimetype };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve the current approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approve(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject at the current approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async reject(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/return')
  @ApiOperation({
    summary: 'Send back for revision (pending_approval → draft, current step rejected with note)',
  })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async returnForRevision(
    @Param('id') id: string,
    @Body() dto: RequiredNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.returnForRevision(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/remind')
  @ApiOperation({
    summary: 'Remind approvers of the current pending step (in-app, max once per 10 minutes)',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, description: '{ remindedAt, role, recipients }' })
  @ApiResponse({ status: 429, description: 'Reminded less than 10 minutes ago' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async remind(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remind(id, user.tenantId!, user.id!);
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
  async submitBudget(
    @Param('id') id: string,
    @Body() dto: SubmitBudgetDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.submitBudget(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/budget/approve')
  @ApiOperation({ summary: 'Approve the current budget approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async approveBudget(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.approveBudget(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/budget/reject')
  @ApiOperation({ summary: 'Reject the budget (requester revises and resubmits)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async rejectBudget(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.rejectBudget(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/budget/decline')
  @ApiOperation({ summary: 'Decline the budget (budget_pending → rejected)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async declineBudget(
    @Param('id') id: string,
    @Body() dto: RequiredNoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.declineBudget(id, dto, user.tenantId!, user.id!);
  }

  // ── Stage 3: equipment ─────────────────────────────────────────────────────

  @Post(':id/equipment')
  @ApiOperation({ summary: 'Request equipment for this manpower request' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async createEquipment(
    @Param('id') id: string,
    @Body() dto: CreateEquipmentRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.equipmentService.create(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — equipment requests')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr/equipment-requests', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class EquipmentRequestController {
  constructor(private readonly service: EquipmentRequestService) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Get an equipment request (+stock availability & linked PR when inventory addon active)',
  })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOneWithAvailability(id, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a pending equipment request (prevents duplicate requests before approval)',
  })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve the current equipment approval step' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.approve(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject the equipment request' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async reject(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.reject(id, dto, user.tenantId!, user.id!);
  }
}
