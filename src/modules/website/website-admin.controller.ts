import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WebsiteInquiry } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SiteWithEligibility, WebsiteService } from './website.service';
import { PublicReview, SitePayload } from './website-public.service';
import { CreateWebsiteSiteDto } from './dto/create-website-site.dto';
import { UpdateWebsiteSiteDto } from './dto/update-website-site.dto';
import { UpdateWebsiteInquiryDto, WebsiteInquiryQueryDto } from './dto/website-inquiry-query.dto';
import { INQUIRY_ROLES, SITE_EDITOR_ROLES, WEBSITE_ADDON_CODE } from './website.constants';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface AuthUser {
  id?: string;
  tenantId?: string;
}

const MAX_UPLOAD_FILES = 10;

/**
 * เจ้าของโรงแรมจัดการเว็บไซต์ของตัวเอง
 * AddonGuard ปล่อย trial ผ่าน (แก้/preview ได้) — ส่วน publish เช็คสิทธิ์ซ้ำใน service
 */
@ApiTags('website')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'website' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon(WEBSITE_ADDON_CODE)
export class WebsiteAdminController {
  constructor(private readonly website: WebsiteService) {}

  @Get('sites')
  @ApiOperation({ summary: 'List hotel websites of current tenant' })
  @ApiResponse({ status: 200, description: 'Sites with publish eligibility' })
  @Roles(...SITE_EDITOR_ROLES)
  listSites(@CurrentUser() user: AuthUser): Promise<SiteWithEligibility[]> {
    return this.website.listSites(this.tenantOf(user));
  }

  @Get('slug-check')
  @ApiOperation({ summary: 'Check whether a subdomain slug is available' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiQuery({ name: 'excludeSiteId', required: false })
  @ApiResponse({ status: 200, description: '{ slug, available, reason }' })
  @Roles(...SITE_EDITOR_ROLES)
  checkSlug(
    @CurrentUser() user: AuthUser,
    @Query('slug') slug: string,
    @Query('excludeSiteId') excludeSiteId?: string,
  ): Promise<{ slug: string; available: boolean; reason: string | null }> {
    this.tenantOf(user);
    return this.website.checkSlug(slug ?? '', excludeSiteId || undefined);
  }

  @Post('sites')
  @ApiOperation({ summary: 'Create the hotel website (1 per tenant in MVP)' })
  @ApiResponse({ status: 201, description: 'Site created as DRAFT' })
  @ApiResponse({ status: 409, description: 'Slug taken or tenant already has a site' })
  @Roles(...SITE_EDITOR_ROLES)
  createSite(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWebsiteSiteDto,
  ): Promise<SiteWithEligibility> {
    return this.website.createSite(this.tenantOf(user), dto);
  }

  @Get('sites/:id')
  @ApiOperation({ summary: 'Get site (draft + published content)' })
  @ApiResponse({ status: 404, description: 'Site not found' })
  @Roles(...SITE_EDITOR_ROLES)
  getSite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SiteWithEligibility> {
    return this.website.getSite(id, this.tenantOf(user));
  }

  @Patch('sites/:id')
  @ApiOperation({ summary: 'Update draft content / theme / seo / slug' })
  @ApiResponse({ status: 200, description: 'Draft saved (published version unchanged)' })
  @Roles(...SITE_EDITOR_ROLES)
  updateSite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebsiteSiteDto,
  ): Promise<SiteWithEligibility> {
    return this.website.updateSite(id, this.tenantOf(user), dto);
  }

  @Get('sites/:id/preview')
  @ApiOperation({ summary: 'Render payload of the draft (same shape as public site)' })
  @Roles(...SITE_EDITOR_ROLES)
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SitePayload> {
    return this.website.preview(id, this.tenantOf(user));
  }

  @Post('sites/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish draft — blocked for trial / no add-on' })
  @ApiResponse({ status: 200, description: 'Published' })
  @ApiResponse({
    status: 403,
    description:
      'WEBSITE_PUBLISH_TRIAL | WEBSITE_PUBLISH_ADDON_REQUIRED | WEBSITE_PUBLISH_WRONG_PRODUCT_LINE',
  })
  @Roles(...SITE_EDITOR_ROLES)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SiteWithEligibility> {
    return this.website.publish(id, this.tenantOf(user));
  }

  @Post('sites/:id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take the site offline' })
  @Roles(...SITE_EDITOR_ROLES)
  unpublish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SiteWithEligibility> {
    return this.website.unpublish(id, this.tenantOf(user));
  }

  @Get('sites/:id/review-options')
  @ApiOperation({ summary: 'Guest reviews available to feature on the site' })
  @Roles(...SITE_EDITOR_ROLES)
  reviewOptions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PublicReview[]> {
    return this.website.reviewOptions(id, this.tenantOf(user));
  }

  @Post('images')
  @ApiOperation({ summary: 'Upload website images (hero, gallery, offers, logo)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: '{ urls: string[] }' })
  @Roles(...SITE_EDITOR_ROLES)
  @UseInterceptors(
    FilesInterceptor('images', MAX_UPLOAD_FILES, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/^image\/(jpeg|jpg|png|webp)$/)) {
          return cb(new BadRequestException('รองรับเฉพาะรูป JPG, PNG, WEBP'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadImages(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: MulterFile[],
  ): Promise<{ urls: string[] }> {
    return this.website.uploadImages(this.tenantOf(user), files);
  }

  @Get('inquiries')
  @ApiOperation({ summary: 'List inquiries / booking requests from the website' })
  @Roles(...INQUIRY_ROLES)
  listInquiries(
    @CurrentUser() user: AuthUser,
    @Query() query: WebsiteInquiryQueryDto,
  ): Promise<{ data: WebsiteInquiry[]; total: number; page: number; limit: number }> {
    return this.website.listInquiries(this.tenantOf(user), query);
  }

  @Get('inquiries/new-count')
  @ApiOperation({ summary: 'Count of NEW inquiries (sidebar badge)' })
  @Roles(...INQUIRY_ROLES)
  countNew(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return this.website.countNewInquiries(this.tenantOf(user));
  }

  @Patch('inquiries/:id')
  @ApiOperation({ summary: 'Update inquiry status / link to a booking' })
  @ApiResponse({ status: 400, description: 'Booking not in this tenant' })
  @Roles(...INQUIRY_ROLES)
  updateInquiry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebsiteInquiryDto,
  ): Promise<WebsiteInquiry> {
    return this.website.updateInquiry(id, this.tenantOf(user), dto);
  }

  /** platform admin ที่ไม่มี tenant ห้ามเข้ามาสร้างเว็บลอย ๆ */
  private tenantOf(user: AuthUser): string {
    if (!user?.tenantId) throw new ForbiddenException('ต้องเข้าใช้งานในนามโรงแรม');
    return user.tenantId;
  }
}
