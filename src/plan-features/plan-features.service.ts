import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanFeatureDto } from './dto/create-plan-feature.dto';

@Injectable()
export class PlanFeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createPlanFeatureDto: CreatePlanFeatureDto) {
    const data: any = {
      plan_id: createPlanFeatureDto.planId,
      feature_id: createPlanFeatureDto.featureId,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.plan_features.create({
      data,
      include: { plans: true, features: true },
    });
  }

  findAll() {
    return this.prisma.plan_features.findMany({
      include: { plans: true, features: true },
    });
  }

  findByPlanId(planId: string) {
    return this.prisma.plan_features.findMany({
      where: { plan_id: planId },
      include: { features: true },
    });
  }

  remove(id: string) {
    return this.prisma.plan_features.delete({
      where: { id },
    });
  }
}


