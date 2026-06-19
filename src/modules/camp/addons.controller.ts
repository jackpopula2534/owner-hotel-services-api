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
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
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
  filename: string;
}

@ApiTags('camp-addons')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/addons', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AddonsController {
  constructor(private readonly service: AddonsService) {}

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
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(process.cwd(), 'uploads', 'camp');
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const addonId = req.params.id;
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = extname(file.originalname);
          cb(null, `addon-${addonId}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp|gif)$/)) {
          return cb(new BadRequestException('อัปโหลดได้เฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB ต่อไฟล์
    }),
  )
  uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: MulterFile[],
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('ไม่พบไฟล์รูปภาพ');
    }
    const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 9011}`;
    const imageUrls = files.map((file) => `${baseUrl}/uploads/camp/${file.filename}`);
    return this.service.addImages(id, imageUrls, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete rental addon' })
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user?.tenantId);
  }
}
