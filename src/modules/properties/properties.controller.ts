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
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { UpdateTimeSettingsDto } from './dto/update-time-settings.dto';
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all properties' })
  @ApiResponse({ status: 200, description: 'List of properties' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
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
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
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
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.update(id, updatePropertyDto, user.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update property (partial)' })
  @ApiResponse({ status: 200, description: 'Property updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async partialUpdate(
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.',
      );
    }
    return this.propertiesService.update(id, updatePropertyDto, user.tenantId);
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
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'receptionist')
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
}
