import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { JobPostingService } from './job-posting.service';
import { UpsertJobPostingDto, PublicApplicationDto } from './dto/recruitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

// Minimal multer file shape (avoid @types/multer dependency — same as rooms.controller).
interface MulterFile {
  originalname: string;
  mimetype: string;
  filename: string;
}

const APPLICATION_UPLOAD_KINDS = ['resume', 'photo', 'document'] as const;

// ─── Dashboard: manage a request's public job posting ─────────────────────────

@ApiTags('hr / recruitment — job posting')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/manpower-requests/:manpowerRequestId/job-posting', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class JobPostingController {
  constructor(private readonly service: JobPostingService) {}

  @Get()
  @ApiOperation({ summary: 'Get the public job posting for a manpower request' })
  @ApiParam({ name: 'manpowerRequestId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async get(@Param('manpowerRequestId') manpowerRequestId: string, @CurrentUser() user: AuthUser) {
    return this.service.getForRequest(manpowerRequestId, user.tenantId!);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update the public job posting (recruiting stage only)' })
  @ApiParam({ name: 'manpowerRequestId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async upsert(
    @Param('manpowerRequestId') manpowerRequestId: string,
    @Body() dto: UpsertJobPostingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.upsert(manpowerRequestId, dto, user.tenantId!, user.id!);
  }

  @Post('publish')
  @ApiOperation({ summary: 'Publish the job posting (link becomes live within its window)' })
  @ApiParam({ name: 'manpowerRequestId' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async publish(@Param('manpowerRequestId') manpowerRequestId: string, @CurrentUser() user: AuthUser) {
    return this.service.publish(manpowerRequestId, user.tenantId!, user.id!);
  }

  @Post('close')
  @ApiOperation({ summary: 'Close the job posting (stop accepting applications)' })
  @ApiParam({ name: 'manpowerRequestId' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async close(@Param('manpowerRequestId') manpowerRequestId: string, @CurrentUser() user: AuthUser) {
    return this.service.close(manpowerRequestId, user.tenantId!, user.id!);
  }
}

// ─── Public: view posting + submit application (no auth) ──────────────────────

@ApiTags('public / jobs')
@Controller({ path: 'public/jobs', version: '1' })
export class PublicJobController {
  constructor(private readonly service: JobPostingService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Get a public job posting by token' })
  @ApiParam({ name: 'token' })
  @Throttle({ default: { limit: 60, ttl: 60 } })
  async getByToken(@Param('token') token: string) {
    return this.service.getPublicByToken(token);
  }

  @Public()
  @Post(':token/apply')
  @ApiOperation({ summary: 'Submit a public application (creates a candidate)' })
  @ApiParam({ name: 'token' })
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async apply(@Param('token') token: string, @Body() dto: PublicApplicationDto) {
    return this.service.submitApplication(token, dto);
  }

  @Public()
  @Post(':token/uploads')
  @ApiOperation({ summary: 'Upload application files (resume / photo / document)' })
  @ApiParam({ name: 'token' })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 15, ttl: 60 } })
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'applications');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const token = req.params.token;
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `app-${token}-${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^(image\/(jpeg|jpg|png|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/)) {
          return cb(new BadRequestException('รองรับเฉพาะไฟล์ PDF, DOC/DOCX, รูปภาพ'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('token') token: string,
    @Query('kind') kind: string,
    @UploadedFiles() files: MulterFile[],
  ) {
    // เช็คว่าประกาศยังเปิดรับอยู่ (ไฟล์ที่อัปแล้วจะกลายเป็น orphan ถ้าปิด — รับได้)
    await this.service.requireOpenPosting(token);
    if (!files || files.length === 0) throw new BadRequestException('ไม่พบไฟล์ที่อัปโหลด');

    const safeKind = (APPLICATION_UPLOAD_KINDS as readonly string[]).includes(kind) ? kind : 'document';
    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 9011}`;
    const urls = files.map((file) => ({
      kind: safeKind,
      url: `${baseUrl}/uploads/applications/${file.filename}`,
      name: file.originalname,
    }));
    return { urls };
  }
}
