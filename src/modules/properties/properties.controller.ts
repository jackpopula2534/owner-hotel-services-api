import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('properties')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'properties', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all properties' })
  @ApiResponse({ status: 200, description: 'List of properties' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.'
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
        'No tenant found. Please complete the onboarding process first to set up your hotel.'
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
        'No tenant found. Please complete the onboarding process first to set up your hotel.'
      );
    }
    return this.propertiesService.create(createPropertyDto, user.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update property' })
  @ApiResponse({ status: 200, description: 'Property updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.'
      );
    }
    return this.propertiesService.update(id, updatePropertyDto, user.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete property' })
  @ApiResponse({ status: 200, description: 'Property deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    if (!user?.tenantId) {
      throw new BadRequestException(
        'No tenant found. Please complete the onboarding process first to set up your hotel.'
      );
    }
    return this.propertiesService.remove(id, user.tenantId);
  }
}
