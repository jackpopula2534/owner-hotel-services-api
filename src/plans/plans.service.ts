import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
  ) {}

  create(createPlanDto: CreatePlanDto): Promise<Plan> {
    const plan = this.plansRepository.create(createPlanDto);
    return this.plansRepository.save(plan);
  }

  findAll(): Promise<Plan[]> {
    return this.plansRepository.find({
      where: { isActive: true },
      relations: ['planFeatures', 'planFeatures.feature'],
    });
  }

  findOne(id: string): Promise<Plan> {
    return this.plansRepository.findOne({
      where: { id },
      relations: ['planFeatures', 'planFeatures.feature'],
    });
  }

  findByCode(code: string): Promise<Plan> {
    return this.plansRepository.findOne({
      where: { code },
      relations: ['planFeatures', 'planFeatures.feature'],
    });
  }

  update(id: string, updatePlanDto: UpdatePlanDto): Promise<Plan> {
    return this.plansRepository.save({
      id,
      ...updatePlanDto,
    });
  }

  remove(id: string): Promise<void> {
    return this.plansRepository.delete(id).then(() => undefined);
  }
}


