import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  create(createPlanDto: CreatePlanDto) {
    return this.prisma.plans.create({
      data: createPlanDto as any,
      include: { plan_features: { include: { features: true } } },
    });
  }

  findAll() {
    return this.prisma.plans.findMany({
      where: { is_active: 1 },
      include: { plan_features: { include: { features: true } } },
      orderBy: [{ display_order: 'asc' }, { price_monthly: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.prisma.plans.findUnique({
      where: { id },
      include: { plan_features: { include: { features: true } } },
    });
  }

  findByCode(code: string) {
    return this.prisma.plans.findUnique({
      where: { code },
      include: { plan_features: { include: { features: true } } },
    });
  }

  update(id: string, updatePlanDto: UpdatePlanDto) {
    return this.prisma.plans.update({
      where: { id },
      data: updatePlanDto,
      include: { plan_features: { include: { features: true } } },
    });
  }

  remove(id: string) {
    return this.prisma.plans.delete({
      where: { id },
    });
  }
}


