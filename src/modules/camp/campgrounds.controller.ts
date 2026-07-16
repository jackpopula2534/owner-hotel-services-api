import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '@/common/storage/storage.service';
import { CampgroundsService } from './campgrounds.service';
import {
  CreateCampgroundDto,
  UpdateCampgroundDto,
  UploadMapDto,
} from './dto/campground.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];
const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin'];

// Minimal multer file shape — avoids depending on @types/multer
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  filename: string;
}

@ApiTags('camp-campgrounds')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/campgrounds', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class CampgroundsController {
  constructor(
    private readonly service: CampgroundsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List campgrounds' })
  @ApiResponse({ status: 200, description: 'List of campgrounds' })
  @Roles(...READ_ROLES)
  findAll(@CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campground by id (with zones + pitches)' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create campground' })
  @ApiResponse({ status: 201, description: 'Created' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateCampgroundDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update campground' })
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCampgroundDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId);
  }

  @Patch(':id/map')
  @ApiOperation({ summary: 'Set campground map image + canvas size' })
  @Roles(...WRITE_ROLES)
  setMap(
    @Param('id') id: string,
    @Body() dto: UploadMapDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.setMap(id, dto, user?.tenantId);
  }

  @Post(':id/map/upload')
  @ApiOperation({ summary: 'Upload campground layout image from device' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Map image uploaded' })
  @Roles(...WRITE_ROLES)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadMap(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!file) {
      throw new BadRequestException('ไม่พบไฟล์รูปภาพ');
    }
    const saved = await this.storage.save({
      folder: 'camp',
      file,
      prefix: `camp-${id}`,
    });
    const mapImageUrl = saved.url;
    return this.service.setMap(id, { mapImageUrl }, user?.tenantId);
  }

  @Post(':id/images')
  @ApiOperation({ summary: 'Upload campground gallery images (multiple) from device' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  @Roles(...WRITE_ROLES)
  @UseInterceptors(
    FilesInterceptor('images', 12, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB ต่อไฟล์
    }),
  )
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[],
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('ไม่พบไฟล์รูปภาพ');
    }
    const saved = await this.storage.saveMany(files, {
      folder: 'camp',
      prefix: `camp-${id}-img`,
    });
    const imageUrls = saved.map((s) => s.url);
    return this.service.addImages(id, imageUrls, user?.tenantId);
  }

  @Post(':id/inventory/connect')
  @ApiOperation({
    summary: 'Connect campground to Inventory Module (auto-create sub-warehouse)',
  })
  @ApiResponse({ status: 201, description: 'Connected; warehouse ensured' })
  @Roles(...WRITE_ROLES)
  connectInventory(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.connectInventory(id, user?.tenantId);
  }

  @Post(':id/inventory/disconnect')
  @ApiOperation({ summary: 'Disconnect campground from Inventory Module' })
  @Roles(...WRITE_ROLES)
  disconnectInventory(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.disconnectInventory(id, user?.tenantId);
  }

  @Post(':id/pos/connect')
  @ApiOperation({ summary: 'Connect campground to POS Module (manual per-campground)' })
  @Roles(...WRITE_ROLES)
  connectPos(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.connectPos(id, user?.tenantId);
  }

  @Post(':id/pos/disconnect')
  @ApiOperation({ summary: 'Disconnect campground from POS Module' })
  @Roles(...WRITE_ROLES)
  disconnectPos(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.disconnectPos(id, user?.tenantId);
  }

  @Post(':id/kitchen/connect')
  @ApiOperation({ summary: 'Connect campground to Kitchen Display (KDS) — manual per-campground' })
  @Roles(...WRITE_ROLES)
  connectKitchen(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.connectKitchen(id, user?.tenantId);
  }

  @Post(':id/kitchen/disconnect')
  @ApiOperation({ summary: 'Disconnect campground from Kitchen Display (KDS)' })
  @Roles(...WRITE_ROLES)
  disconnectKitchen(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.disconnectKitchen(id, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete campground' })
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user?.tenantId);
  }
}
