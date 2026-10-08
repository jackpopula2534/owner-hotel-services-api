import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { PropertyTimeSettingsService } from './property-time-settings.service';
import { PropertyHolidaysService } from './property-holidays.service';
import { PropertyPromoCodesService } from './property-promo-codes.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { UpdateTimeSettingsDto } from './dto/update-time-settings.dto';
import { ReplaceHolidaysDto } from './dto/replace-holidays.dto';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('properties')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'properties', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PropertiesController {
  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly timeSettingsService: PropertyTimeSettingsService,
    private readonly holidaysService: PropertyHolidaysService,
    private readonly promoCodesService: PropertyPromoCodesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all properties' })
  @ApiResponse({ status: 200, description: 'List of properties' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager', 'front_desk')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.findAll(query, user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get property by ID' })
  @ApiResponse({ status: 200, description: 'Property details' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager', 'front_desk')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.findOne(id, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new property' })
  @ApiResponse({ status: 201, description: 'Property created successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async create(
    @Body() createPropertyDto: CreatePropertyDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.create(createPropertyDto, user.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update property (full)' })
  @ApiResponse({ status: 200, description: 'Property updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.update(id, updatePropertyDto, user.tenantId, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update property (partial)' })
  @ApiResponse({ status: 200, description: 'Property updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async partialUpdate(
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.update(id, updatePropertyDto, user.tenantId, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete property' })
  @ApiResponse({ status: 200, description: 'Property soft-deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.remove(id, user.tenantId);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted property' })
  @ApiResponse({ status: 200, description: 'Property restored successfully' })
  @ApiResponse({ status: 400, description: 'Property is not deleted' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async restore(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.restore(id, user.tenantId);
  }

  // ─── Time Settings endpoints ─────────────────────────────────────────────

  @Get(':id/time-settings')
  @ApiOperation({
    summary: 'Get property time & cleaning settings',
    description:
      'Returns standardCheckInTime, standardCheckOutTime, cleaningBufferMinutes, early/late checkout config and timezone.',
  })
  @ApiResponse({ status: 200, description: 'Time settings retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'receptionist',
    'hotel_manager',
    'front_desk',
  )
  async getTimeSettings(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.timeSettingsService.getTimeSettings(id, user.tenantId);
  }

  @Put(':id/time-settings')
  @ApiOperation({
    summary: 'Update property time & cleaning settings',
    description:
      'Update check-in/out standard times, cleaning buffer, and early/late checkout fees.',
  })
  @ApiResponse({ status: 200, description: 'Time settings updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error (e.g. fee not set when enabling)' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async updateTimeSettings(
    @Param('id') id: string,
    @Body() dto: UpdateTimeSettingsDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.timeSettingsService.updateTimeSettings(id, user.tenantId, dto);
  }

  // ─── Holidays (ใช้คิดราคาวันหยุด) ─────────────────────────────────────────

  @Get(':id/holidays')
  @ApiOperation({
    summary: 'Get property holiday settings',
    description: 'Public holidays the hotel turned off + custom holidays used for holiday room rates.',
  })
  @ApiResponse({ status: 200, description: 'Holiday settings' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @Roles(
    'admin',
    'manager',
    'tenant_admin',
    'platform_admin',
    'receptionist',
    'hotel_manager',
    'front_desk',
  )
  async getHolidays(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.holidaysService.getSettings(id, user.tenantId);
  }

  @Put(':id/holidays')
  @ApiOperation({
    summary: 'Replace property holiday settings',
    description: 'Replaces disabled public holidays and custom holidays in one call.',
  })
  @ApiResponse({ status: 200, description: 'Holiday settings saved' })
  @ApiResponse({ status: 400, description: 'Invalid date or range' })
  @ApiResponse({ status: 404, description: 'Property not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager')
  async replaceHolidays(
    @Param('id') id: string,
    @Body() dto: ReplaceHolidaysDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.holidaysService.replaceSettings(id, user.tenantId, dto);
  }

  // ─── Promo codes (โค้ดส่วนลดสำหรับการจองผ่านหน้าเว็บ) ──────────────────────

  @Get(':id/promo-codes')
  @ApiOperation({ summary: 'List property promo codes' })
  @ApiResponse({ status: 200, description: 'Promo codes with usage counts' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager')
  async listPromoCodes(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.promoCodesService.list(id, user.tenantId);
  }

  @Post(':id/promo-codes')
  @ApiOperation({ summary: 'Create a property promo code' })
  @ApiResponse({ status: 201, description: 'Promo code created' })
  @ApiResponse({ status: 409, description: 'Code already exists for this property' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager')
  async createPromoCode(
    @Param('id') id: string,
    @Body() dto: CreatePromoCodeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.promoCodesService.create(id, user.tenantId, dto);
  }

  @Patch(':id/promo-codes/:codeId')
  @ApiOperation({ summary: 'Update a property promo code' })
  @ApiResponse({ status: 200, description: 'Promo code updated' })
  @ApiResponse({ status: 404, description: 'Promo code not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager')
  async updatePromoCode(
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @Body() dto: UpdatePromoCodeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.promoCodesService.update(id, codeId, user.tenantId, dto);
  }

  @Delete(':id/promo-codes/:codeId')
  @ApiOperation({ summary: 'Delete a property promo code' })
  @ApiResponse({ status: 200, description: 'Promo code deleted' })
  @ApiResponse({ status: 404, description: 'Promo code not found' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'hotel_manager')
  async deletePromoCode(
    @Param('id') id: string,
    @Param('codeId') codeId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) throw new BadRequestException('No tenant found.');
    return this.promoCodesService.remove(id, codeId, user.tenantId);
  }
}
