import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    createPlanDto: CreatePlanDto & {
      id?: string;
      displayOrder?: number;
      isPopular?: boolean;
      badge?: string;
      highlightColor?: string;
      features?: string;
      buttonText?: string;
      description?: string;
      yearlyDiscountPercent?: number;
      subtitle?: string;
      targetAudience?: string;
      pricePerRoom?: string;
    },
  ) {
    const data: any = {
      id: createPlanDto.id,
      code: createPlanDto.code,
      name: createPlanDto.name,
      price_monthly: createPlanDto.priceMonthly,
      max_rooms: createPlanDto.maxRooms,
      max_users: createPlanDto.maxUsers,
      is_active: createPlanDto.isActive !== undefined ? (createPlanDto.isActive ? 1 : 0) : 1,
      // Sales Page fields
      display_order: createPlanDto.displayOrder,
      is_popular: createPlanDto.isPopular !== undefined ? (createPlanDto.isPopular ? 1 : 0) : 0,
      badge: createPlanDto.badge,
      highlight_color: createPlanDto.highlightColor,
      features: createPlanDto.features,
      button_text: createPlanDto.buttonText,
      description: createPlanDto.description,
      yearly_discount_percent: createPlanDto.yearlyDiscountPercent || 0,
      subtitle: createPlanDto.subtitle,
      target_audience: createPlanDto.targetAudience,
      price_per_room: createPlanDto.pricePerRoom,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.plans.create({
      data,
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

  update(
    id: string,
    updatePlanDto: UpdatePlanDto & {
      displayOrder?: number;
      isPopular?: boolean;
      badge?: string;
      highlightColor?: string;
      features?: string;
      buttonText?: string;
      description?: string;
      yearlyDiscountPercent?: number;
      subtitle?: string;
      targetAudience?: string;
      pricePerRoom?: string;
    },
  ) {
    const data: any = {
      code: updatePlanDto.code,
      name: updatePlanDto.name,
      price_monthly: updatePlanDto.priceMonthly,
      max_rooms: updatePlanDto.maxRooms,
      max_users: updatePlanDto.maxUsers,
      is_active:
        updatePlanDto.isActive !== undefined ? (updatePlanDto.isActive ? 1 : 0) : undefined,
      // Sales Page fields
      display_order: updatePlanDto.displayOrder,
      is_popular:
        updatePlanDto.isPopular !== undefined ? (updatePlanDto.isPopular ? 1 : 0) : undefined,
      badge: updatePlanDto.badge,
      highlight_color: updatePlanDto.highlightColor,
      features: updatePlanDto.features,
      button_text: updatePlanDto.buttonText,
      description: updatePlanDto.description,
      yearly_discount_percent: updatePlanDto.yearlyDiscountPercent,
      subtitle: updatePlanDto.subtitle,
      target_audience: updatePlanDto.targetAudience,
      price_per_room: updatePlanDto.pricePerRoom,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.plans.update({
      where: { id },
      data,
      include: { plan_features: { include: { features: true } } },
    });
  }

  remove(id: string) {
    return this.prisma.plans.delete({
      where: { id },
    });
  }
}
