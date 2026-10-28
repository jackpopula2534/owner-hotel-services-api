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
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { AllowSystems } from '@/common/decorators/allow-systems.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { DocumentSettingsService } from './document-settings.service';
import { UpdateDocumentSettingsDto } from './dto/update-document-settings.dto';

// The legal entity printed on every PO, receipt and tax invoice — editing it is
// a manager's call. procurement_manager is the floor, so manager / tenant_admin /
// admin inherit; owner and accounting_manager carry no rank and are named outright.
const SETTINGS_EDITORS = ['procurement_manager', 'owner', 'accounting_manager'] as const;

interface AuthUser {
  tenantId: string;
  userId: string;
}

@ApiTags('Document Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('document-settings')
export class DocumentSettingsController {
  constructor(
    private readonly service: DocumentSettingsService,
    private readonly storage: StorageService,
  ) {}

  // A tax invoice printed at the till has to name the registered entity behind
  // the outlet — legal name, tax id, branch — and that lives here. Reading it is
  // all the POS needs; writing the settings stays closed to POS tokens.
  @AllowSystems('pos')
  @ApiOperation({ summary: 'Get document settings for a property' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Document settings retrieved' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @Get()
  async get(
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; data: Record<string, unknown> }> {
    const [data, companyFallback] = await Promise.all([
      this.service.getByProperty(user.tenantId, propertyId),
      this.service.getCompanyFallback(user.tenantId),
    ]);
    return { success: true, data: { ...data, companyFallback } };
  }

  @ApiOperation({ summary: 'Update document settings for a property' })
  @ApiQuery({ name: 'propertyId', required: true, description: 'Property ID' })
  @ApiResponse({ status: 200, description: 'Document settings updated' })
  @Patch()
  @Roles(...SETTINGS_EDITORS)
  @ApiResponse({ status: 403, description: 'Role may not edit document settings' })
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
  @Roles(...SETTINGS_EDITORS)
  @ApiResponse({ status: 403, description: 'Role may not edit document settings' })
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
  @Roles(...SETTINGS_EDITORS)
  @ApiResponse({ status: 403, description: 'Role may not edit document settings' })
  async removeLogo(
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ success: boolean; message: string }> {
    await this.service.removeLogo(user.tenantId, propertyId);
    return { success: true, message: 'Logo removed successfully' };
  }
}
