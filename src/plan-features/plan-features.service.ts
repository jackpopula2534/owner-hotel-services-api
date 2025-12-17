import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanFeature } from './entities/plan-feature.entity';
import { CreatePlanFeatureDto } from './dto/create-plan-feature.dto';

@Injectable()
export class PlanFeaturesService {
  constructor(
    @InjectRepository(PlanFeature)
    private planFeaturesRepository: Repository<PlanFeature>,
  ) {}

  create(createPlanFeatureDto: CreatePlanFeatureDto): Promise<PlanFeature> {
    const planFeature = this.planFeaturesRepository.create(createPlanFeatureDto);
    return this.planFeaturesRepository.save(planFeature);
  }

  findAll(): Promise<PlanFeature[]> {
    return this.planFeaturesRepository.find({
      relations: ['plan', 'feature'],
    });
  }

  findByPlanId(planId: string): Promise<PlanFeature[]> {
    return this.planFeaturesRepository.find({
      where: { planId },
      relations: ['feature'],
    });
  }

  remove(id: string): Promise<void> {
    return this.planFeaturesRepository.delete(id).then(() => undefined);
  }
}


