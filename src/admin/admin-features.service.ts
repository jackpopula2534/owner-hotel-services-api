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
   * Get all features ordered by category and display order so the UI can
   * group them without an extra client-side sort.
   */
  async findAll(): Promise<AdminFeaturesListDto> {
    const features = await this.featuresRepository.find({
      order: { category: 'ASC', displayOrder: 'ASC', name: 'ASC' },
    });

    const data: AdminFeatureItemDto[] = features.map((feature) => ({
      id: feature.id,
      code: feature.code,
      name: feature.name,
      description: feature.description || '',
      type: feature.type,
      category: feature.category ?? null,
      icon: feature.icon ?? null,
      displayOrder: feature.displayOrder ?? 0,
      priceMonthly: Number(feature.priceMonthly || 0),
      priceYearly: undefined,
      isActive: feature.isActive !== false,
      createdAt: 'N/A',
    }));

    return {
      data,
      total: data.length,
    };
  }

  /**
   * GET /api/v1/admin/features/:id
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
      category: feature.category ?? null,
      icon: feature.icon ?? null,
      displayOrder: feature.displayOrder ?? 0,
      priceMonthly: Number(feature.priceMonthly || 0),
      priceYearly: undefined,
      isActive: feature.isActive !== false,
      metadata: undefined,
      createdAt: 'N/A',
      updatedAt: 'N/A',
    };
  }

  /**
   * POST /api/v1/admin/features
   */
  async create(dto: CreateFeatureDto): Promise<FeatureResponseDto> {
    const feature = this.featuresRepository.create({
      code: dto.code,
      name: dto.name,
      description: dto.description,
      type: dto.type as any,
      category: dto.category ?? null,
      icon: dto.icon ?? null,
      displayOrder: dto.displayOrder ?? 0,
      priceMonthly: dto.priceMonthly,
      isActive: dto.isActive !== false,
    });

    await this.featuresRepository.save(feature);

    this.logger.log(`Created feature: ${feature.name} (${feature.code})`);

    return this.findOne(feature.id);
  }

  /**
   * PATCH /api/v1/admin/features/:id
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
    if (dto.type !== undefined) feature.type = dto.type as any;
    if (dto.category !== undefined) feature.category = dto.category ?? null;
    if (dto.icon !== undefined) feature.icon = dto.icon ?? null;
    if (dto.displayOrder !== undefined) feature.displayOrder = dto.displayOrder;
    if (dto.priceMonthly !== undefined) feature.priceMonthly = dto.priceMonthly;
    if (dto.isActive !== undefined) feature.isActive = dto.isActive;

    await this.featuresRepository.save(feature);

    this.logger.log(`Updated feature: ${feature.name} (${feature.code})`);

    return this.findOne(feature.id);
  }

  /**
   * DELETE /api/v1/admin/features/:id  — soft delete via isActive=false
   */
  async remove(id: string): Promise<{ message: string }> {
    const feature = await this.featuresRepository.findOne({
      where: { id },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${id}" not found`);
    }

    feature.isActive = false;
    await this.featuresRepository.save(feature);

    this.logger.log(`Deleted feature: ${feature.name} (${feature.code})`);

    return {
      message: `Feature "${feature.name}" deleted successfully`,
    };
  }
}
