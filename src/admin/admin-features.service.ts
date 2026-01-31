import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feature } from '../features/entities/feature.entity';
import {
  AdminFeaturesListDto,
  AdminFeatureItemDto,
  CreateFeatureDto,
  UpdateFeatureDto,
  FeatureResponseDto,
} from './dto/admin-features.dto';

@Injectable()
export class AdminFeaturesService {
  private readonly logger = new Logger(AdminFeaturesService.name);

  constructor(
    @InjectRepository(Feature)
    private featuresRepository: Repository<Feature>,
  ) {}

  /**
   * GET /api/v1/admin/features
   * Get all features
   */
  async findAll(): Promise<AdminFeaturesListDto> {
    const features = await this.featuresRepository.find({
      order: { type: 'ASC', name: 'ASC' },
    });

    const data: AdminFeatureItemDto[] = features.map((feature) => ({
      id: feature.id,
      code: feature.code,
      name: feature.name,
      description: feature.description || '',
      type: feature.type,
      priceMonthly: Number(feature.priceMonthly || 0),
      priceYearly: undefined, // Not supported in current schema
      isActive: feature.isActive !== false,
      createdAt: 'N/A', // Not supported in current schema
    }));

    return {
      data,
      total: data.length,
    };
  }

  /**
   * GET /api/v1/admin/features/:id
   * Get feature by ID
   */
  async findOne(id: string): Promise<FeatureResponseDto> {
    const feature = await this.featuresRepository.findOne({
      where: { id },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${id}" not found`);
    }

    return {
      id: feature.id,
      code: feature.code,
      name: feature.name,
      description: feature.description || '',
      type: feature.type,
      priceMonthly: Number(feature.priceMonthly || 0),
      priceYearly: undefined, // Not supported in current schema
      isActive: feature.isActive !== false,
      metadata: undefined, // Not supported in current schema
      createdAt: 'N/A', // Not supported in current schema
      updatedAt: 'N/A', // Not supported in current schema
    };
  }

  /**
   * POST /api/v1/admin/features
   * Create a new feature
   */
  async create(dto: CreateFeatureDto): Promise<FeatureResponseDto> {
    const feature = this.featuresRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      type: dto.type as any, // Cast to match entity enum
      priceMonthly: dto.priceMonthly,
      isActive: dto.isActive !== false,
      // Note: priceYearly and metadata not supported in current schema
    });

    await this.featuresRepository.save(feature);

    this.logger.log(`Created feature: ${feature.name} (${feature.code})`);

    return this.findOne(feature.id);
  }

  /**
   * PATCH /api/v1/admin/features/:id
   * Update a feature
   */
  async update(id: string, dto: UpdateFeatureDto): Promise<FeatureResponseDto> {
    const feature = await this.featuresRepository.findOne({
      where: { id },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${id}" not found`);
    }

    if (dto.name !== undefined) feature.name = dto.name;
    if (dto.description !== undefined) feature.description = dto.description;
    if (dto.type !== undefined) feature.type = dto.type as any; // Cast to match entity enum
    if (dto.priceMonthly !== undefined) feature.priceMonthly = dto.priceMonthly;
    if (dto.isActive !== undefined) feature.isActive = dto.isActive;
    // Note: priceYearly and metadata not supported in current schema

    await this.featuresRepository.save(feature);

    this.logger.log(`Updated feature: ${feature.name} (${feature.code})`);

    return this.findOne(feature.id);
  }

  /**
   * DELETE /api/v1/admin/features/:id
   * Delete a feature (soft delete)
   */
  async remove(id: string): Promise<{ message: string }> {
    const feature = await this.featuresRepository.findOne({
      where: { id },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${id}" not found`);
    }

    // Soft delete by setting isActive to false
    feature.isActive = false;
    await this.featuresRepository.save(feature);

    this.logger.log(`Deleted feature: ${feature.name} (${feature.code})`);

    return {
      message: `Feature "${feature.name}" deleted successfully`,
    };
  }
}
