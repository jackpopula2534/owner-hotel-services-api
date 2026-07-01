import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { StorageService } from '@/common/storage/storage.service';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { DocumentSettingsService } from './document-settings.service';
import { UpdateDocumentSettingsDto } from './dto/update-document-settings.dto';

interface AuthUser {
  tenantId: string;
  userId: string;
}

@ApiTags('Document Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('document-settings')
export class DocumentSettingsController {
  constructor(
    private readonly service: DocumentSettingsService,
    private readonly storage: StorageService,
  ) {}

  @ApiOperation({ summary: 'Get document settings for a property' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Document settings retrieved' })
  @Get()
  async get(
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    const data = await this.service.getByProperty(user.tenantId, propertyId);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Update document settings for a property' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Document settings updated' })
  @Patch()
  async update(
    @Query('propertyId') propertyId: string,
    @Body() dto: UpdateDocumentSettingsDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    const data = await this.service.update(user.tenantId, propertyId, dto);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Upload company logo for documents' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Logo uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file type or size' })
  @Post('logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp)$/)) {
          return cb(new BadRequestException('อนุญาตเฉพาะไฟล์ภาพ (JPG, PNG, WebP) เท่านั้น'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async uploadLogo(
    @Query('propertyId') propertyId: string,
    @UploadedFile() file: any,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; data: { logoUrl: string } }> {
    if (!file) {
      throw new BadRequestException('กรุณาเลือกไฟล์ Logo');
    }

    const saved = await this.storage.save({
      folder: 'document-logos',
      file,
      prefix: 'logo',
    });
    const logoUrl = saved.path;
    await this.service.updateLogo(user.tenantId, propertyId, logoUrl);

    return { success: true, data: { logoUrl } };
  }

  @ApiOperation({ summary: 'Remove company logo' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Logo removed' })
  @Delete('logo')
  async removeLogo(
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    await this.service.removeLogo(user.tenantId, propertyId);
    return { success: true, message: 'Logo removed successfully' };
  }
}
