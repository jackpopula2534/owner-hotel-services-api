import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '@/common/storage/storage.service';
import { AddonsService } from './addons.service';
import { CreateAddonDto, UpdateAddonDto } from './dto/addon.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];
const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin'];

interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  filename: string;
}

@ApiTags('camp-addons')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/addons', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AddonsController {
  constructor(
    private readonly service: AddonsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List rental addons by campgroundId' })
  @Roles(...READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll(campgroundId, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get addon by id' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create rental addon' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateAddonDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update rental addon' })
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAddonDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId);
  }

  @Post(':id/images')
  @ApiOperation({ summary: 'Upload addon images (multiple) from device' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Images uploaded' })
  @Roles(...WRITE_ROLES)
  @UseInterceptors(
    FilesInterceptor('images', 10, {
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
      prefix: `addon-${id}`,
    });
    const imageUrls = saved.map((s) => s.url);
    return this.service.addImages(id, imageUrls, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete rental addon' })
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user?.tenantId);
  }
}
