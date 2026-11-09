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
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '../../common/storage/storage.service';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CandidateService } from './candidate.service';
import { InterviewService } from './interview.service';
import { HireService } from './hire.service';
import {
  UpdateCandidateDto,
  ScheduleInterviewDto,
  RescheduleInterviewDto,
  InterviewResultDto,
  MakeOfferDto,
  HireCandidateDto,
  CancelHireDto,
  InterviewConflictQueryDto,
} from './dto/recruitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const CANDIDATE_UPLOAD_KINDS = ['resume', 'photo', 'document'] as const;
const CANDIDATE_UPLOAD_MIME =
  /^(image\/(jpeg|jpg|png|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;

@ApiTags('hr / recruitment — candidates')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr/candidates', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class CandidateController {
  constructor(
    private readonly service: CandidateService,
    private readonly interviewService: InterviewService,
    private readonly hireService: HireService,
    private readonly storage: StorageService,
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

  @Get(':id/history')
  @ApiOperation({
    summary: 'Change history of a candidate (field-level, from the audit log), newest first',
  })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async history(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getHistory(id, user.tenantId!);
  }

  @Post(':id/uploads')
  @ApiOperation({
    summary:
      'Upload candidate files (photo / resume / document) — returns URLs; save them with PATCH attachments',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'kind', enum: CANDIDATE_UPLOAD_KINDS })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!CANDIDATE_UPLOAD_MIME.test(file.mimetype)) {
          return cb(new BadRequestException('รองรับเฉพาะไฟล์ PDF, DOC/DOCX, รูปภาพ'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('id') id: string,
    @Query('kind') kind: string,
    @UploadedFiles() files: MulterFile[],
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.findOne(id, user.tenantId!);
    if (!files || files.length === 0) throw new BadRequestException('ไม่พบไฟล์ที่อัปโหลด');
    const safeKind = (CANDIDATE_UPLOAD_KINDS as readonly string[]).includes(kind)
      ? kind
      : 'document';
    const saved = await this.storage.saveMany(files, {
      folder: 'applications',
      prefix: `cand-${id}`,
    });
    return {
      urls: saved.map((s, i) => ({ kind: safeKind, url: s.url, name: files[i].originalname })),
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a candidate' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCandidateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/interviews')
  @ApiOperation({ summary: 'Schedule an interview for a candidate' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async scheduleInterview(
    @Param('id') id: string,
    @Body() dto: ScheduleInterviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.interviewService.schedule(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/offer')
  @ApiOperation({ summary: 'Make an offer (salary + start date/time + probation length)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async makeOffer(
    @Param('id') id: string,
    @Body() dto: MakeOfferDto,
    @CurrentUser() user: AuthUser,
  ) {
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
  async hire(
    @Param('id') id: string,
    @Body() dto: HireCandidateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.hireService.hire(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — interviews')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
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

  @Get('conflicts')
  @ApiOperation({ summary: 'Overlapping + same-day interviews of the given interviewers' })
  @ApiQuery({ name: 'interviewerIds', required: true, description: 'comma-separated user ids' })
  @ApiQuery({ name: 'scheduledAt', required: true, description: 'ISO datetime' })
  @ApiQuery({ name: 'durationMinutes', required: false, description: 'default 45' })
  @ApiQuery({
    name: 'excludeId',
    required: false,
    description: 'interview id to ignore (when rescheduling)',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async conflicts(@Query() query: InterviewConflictQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findConflicts(
      {
        interviewerIds: query.interviewerIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        scheduledAt: new Date(query.scheduledAt),
        durationMinutes: query.durationMinutes ?? 45,
        excludeId: query.excludeId,
      },
      user.tenantId!,
    );
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
  async reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleInterviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reschedule(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/result')
  @ApiOperation({ summary: 'Record interview result (pass/fail/next_round)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async recordResult(
    @Param('id') id: string,
    @Body() dto: InterviewResultDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordResult(id, dto, user.tenantId!, user.id!);
  }
}

@ApiTags('hr / recruitment — hire records')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
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
  @ApiOperation({
    summary: 'No-show: cancel an accepted hire → release reservations + reopen recruiting',
  })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(@Param('id') id: string, @Body() dto: CancelHireDto, @CurrentUser() user: AuthUser) {
    return this.hireService.cancelNoShow(id, dto, user.tenantId!, user.id!);
  }
}
