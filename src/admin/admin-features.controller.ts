import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminFeaturesService } from './admin-features.service';
import {
  AdminFeaturesListDto,
  CreateFeatureDto,
  UpdateFeatureDto,
  FeatureResponseDto,
} from './dto/admin-features.dto';

@ApiTags('Admin - Features Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/features', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminFeaturesController {
  constructor(private readonly adminFeaturesService: AdminFeaturesService) {}

  /**
   * GET /api/v1/admin/features
   * Get all available features
   */
  @Get()
  @ApiOperation({
    summary: 'Get all features',
    description: 'Retrieve all available features/add-ons in the system',
  })
  @ApiResponse({
    status: 200,
    description: 'Features retrieved successfully',
    type: AdminFeaturesListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  async findAll(): Promise<AdminFeaturesListDto> {
    return this.adminFeaturesService.findAll();
  }

  /**
   * GET /api/v1/admin/features/:id
   * Get feature by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get feature detail',
    description: 'Retrieve detailed information for a specific feature',
  })
  @ApiParam({
    name: 'id',
    description: 'Feature ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature detail retrieved successfully',
    type: FeatureResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Feature not found' })
  async findOne(@Param('id') id: string): Promise<FeatureResponseDto> {
    return this.adminFeaturesService.findOne(id);
  }

  /**
   * POST /api/v1/admin/features
   * Create a new feature
   */
  @Post()
  @ApiOperation({
    summary: 'Create new feature',
    description: 'Create a new feature/add-on in the system',
  })
  @ApiResponse({
    status: 201,
    description: 'Feature created successfully',
    type: FeatureResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  async create(@Body() dto: CreateFeatureDto): Promise<FeatureResponseDto> {
    return this.adminFeaturesService.create(dto);
  }

  /**
   * PATCH /api/v1/admin/features/:id
   * Update a feature
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update feature',
    description: 'Update an existing feature',
  })
  @ApiParam({
    name: 'id',
    description: 'Feature ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature updated successfully',
    type: FeatureResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Feature not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureDto,
  ): Promise<FeatureResponseDto> {
    return this.adminFeaturesService.update(id, dto);
  }

  /**
   * DELETE /api/v1/admin/features/:id
   * Delete a feature
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete feature',
    description: 'Delete a feature (soft delete)',
  })
  @ApiParam({
    name: 'id',
    description: 'Feature ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature deleted successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Feature not found' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.adminFeaturesService.remove(id);
  }
}
