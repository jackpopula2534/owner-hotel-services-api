import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CAMP_MASTER_WRITE_ROLES, CAMP_READ_ROLES } from '../camp-roles';
import { CampMap3dService, UploadedImage } from './camp-map3d.service';
import { Map3dOccupancyQueryDto, SaveMap3dDto, StartMap3dExtractionDto } from './camp-map3d.dto';

interface CampUser {
  id?: string;
  tenantId?: string;
}

const imageUpload = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
        return cb(
          new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'),
          false,
        );
      }
      cb(null, true);
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

/** โมเดล .glb — mimetype ของ glb ไม่แน่นอนข้ามเบราว์เซอร์ ดูจากนามสกุล แล้วให้ service ตรวจเนื้อไฟล์จริง */
const modelUpload = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      if (!/\.glb$/i.test(file.originalname || '')) {
        return cb(new BadRequestException('อัปโหลดได้เฉพาะไฟล์ .glb'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });

function requireTenant(user: CampUser): string {
  if (!user?.tenantId) throw new BadRequestException('ต้องเข้าสู่ระบบด้วยบัญชีของกิจการ');
  return user.tenantId;
}

/**
 * /api/v1/camp/campgrounds/:id/map3d — ฉาก 3D ของลาน (add-on CAMP_3D_MAP)
 *
 * AddonGuard กั้นแค่ CAMP_MODULE (เข้าหน้าได้) — สิทธิ์ CAMP_3D_MAP + โควตา AI
 * เช็กใน service ตรง ๆ เพราะ guard ปล่อย role admin ผ่านโดยไม่ได้ซื้อ
 */
@ApiTags('camp-map3d')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/campgrounds/:id/map3d', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class CampMap3dController {
  constructor(private readonly service: CampMap3dService) {}

  @Get()
  @ApiOperation({ summary: 'Published 3D scene + entitlement + latest AI draft' })
  @Roles(...CAMP_READ_ROLES)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CampUser) {
    return this.service.getMap3d(id, requireTenant(user));
  }

  @Get('occupancy')
  @ApiOperation({
    summary:
      'Stays overlapping a date window for the 3D booking/housekeeping layers (requires CAMP_3D_MAP)',
  })
  @ApiResponse({ status: 403, description: 'ADDON_NOT_ENTITLED' })
  @Roles(...CAMP_READ_ROLES)
  occupancy(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Map3dOccupancyQueryDto,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.getOccupancy(id, requireTenant(user), query.from, query.days ?? 14);
  }

  @Put()
  @ApiOperation({ summary: 'Publish the 3D scene (requires CAMP_3D_MAP)' })
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMap3dDto,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.saveMap3d(id, requireTenant(user), dto.config, user.id);
  }

  @Get('versions')
  @ApiOperation({ summary: 'Published scene history, newest first (max 30, summary only)' })
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  listVersions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CampUser) {
    return this.service.listVersions(id, requireTenant(user));
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: 'One published scene version with its full config (to load back into the editor)' })
  @ApiResponse({ status: 404, description: 'Version not found in this campground' })
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  getVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.getVersion(id, requireTenant(user), versionId);
  }

  @Post('ground')
  @ApiOperation({ summary: 'Upload a ground image for drape mode (no AI, no quota)' })
  @ApiConsumes('multipart/form-data')
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  @UseInterceptors(imageUpload())
  uploadGround(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.uploadGround(id, requireTenant(user), file);
  }

  @Post('models')
  @ApiOperation({
    summary: 'Upload a campground-specific .glb model for a scene prop (no AI, no quota)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 400, description: 'Not a self-contained glTF 2.0 binary' })
  @ApiResponse({ status: 403, description: 'ADDON_NOT_ENTITLED' })
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  @UseInterceptors(modelUpload())
  uploadModel(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.uploadModel(id, requireTenant(user), file);
  }

  @Post('extractions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Let AI draft the scene from a site plan (uses 1 quota, runs in background)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 202, description: 'Draft started — poll GET extractions/:extractionId' })
  @ApiResponse({ status: 402, description: 'QUOTA_EXCEEDED | TRIAL_QUOTA_EXCEEDED' })
  @ApiResponse({ status: 403, description: 'ADDON_NOT_ENTITLED' })
  @ApiResponse({ status: 409, description: 'EXTRACTION_IN_PROGRESS' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @Roles(...CAMP_MASTER_WRITE_ROLES)
  @UseInterceptors(imageUpload())
  startExtraction(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() dto: StartMap3dExtractionDto,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.startExtraction(id, requireTenant(user), user.id, file, dto);
  }

  @Get('extractions/:extractionId')
  @ApiOperation({ summary: 'Poll an AI draft (status/step/result)' })
  @Roles(...CAMP_READ_ROLES)
  getExtraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('extractionId', ParseUUIDPipe) extractionId: string,
    @CurrentUser() user: CampUser,
  ) {
    return this.service.getExtraction(id, extractionId, requireTenant(user));
  }
}
