import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feature } from './entities/feature.entity';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

@Injectable()
export class FeaturesService {
  constructor(
    @InjectRepository(Feature)
    private featuresRepository: Repository<Feature>,
  ) {}

  create(createFeatureDto: CreateFeatureDto): Promise<Feature> {
    const feature = this.featuresRepository.create(createFeatureDto);
    return this.featuresRepository.save(feature);
  }

  findAll(): Promise<Feature[]> {
    return this.featuresRepository.find({
      where: { isActive: true },
    });
  }

  findOne(id: string): Promise<Feature> {
    return this.featuresRepository.findOne({ where: { id } });
  }

  findByCode(code: string): Promise<Feature> {
    return this.featuresRepository.findOne({ where: { code } });
  }

  update(id: string, updateFeatureDto: UpdateFeatureDto): Promise<Feature> {
    return this.featuresRepository.save({
      id,
      ...updateFeatureDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.featuresRepository.delete(id).then(() => undefined);
  }
}


