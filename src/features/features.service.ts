import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createFeatureDto: CreateFeatureDto) {
    const data: any = {
      code: createFeatureDto.code,
      name: createFeatureDto.name,
      description: createFeatureDto.description,
      type: createFeatureDto.type,
      category: createFeatureDto.category,
      icon: createFeatureDto.icon,
      display_order: createFeatureDto.displayOrder,
      price_monthly: createFeatureDto.priceMonthly,
      is_active: createFeatureDto.isActive !== undefined ? (createFeatureDto.isActive ? 1 : 0) : 1,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.features.create({
      data,
    });
  }

  findAll(filters?: { category?: string; isActive?: boolean }) {
    const where: any = {};
    if (filters?.isActive !== undefined) {
      where.is_active = filters.isActive ? 1 : 0;
    } else {
      where.is_active = 1;
    }
    if (filters?.category) {
      where.category = filters.category;
    }

    // Note: orderBy includes `display_order` once `prisma generate` is rerun
    // after the migration. Cast to any here so the build doesn't fail before
    // the user regenerates the Prisma client.
    return this.prisma.features.findMany({
      where,
      orderBy: [{ display_order: 'asc' } as any, { name: 'asc' }],
    });
  }

  findOne(id: string) {
    return this.prisma.features.findUnique({
      where: { id },
    });
  }

  findByCode(code: string) {
    return this.prisma.features.findUnique({
      where: { code },
    });
  }

  update(id: string, updateFeatureDto: UpdateFeatureDto) {
    const data: any = {
      code: updateFeatureDto.code,
      name: updateFeatureDto.name,
      description: updateFeatureDto.description,
      type: updateFeatureDto.type,
      category: updateFeatureDto.category,
      icon: updateFeatureDto.icon,
      display_order: updateFeatureDto.displayOrder,
      price_monthly: updateFeatureDto.priceMonthly,
      is_active:
        updateFeatureDto.isActive !== undefined ? (updateFeatureDto.isActive ? 1 : 0) : undefined,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.features.update({
      where: { id },
      data,
    });
  }

  /**
   * Upsert by unique code — used by the seeder so that re-running the seeder
   * keeps the master catalogue in sync with the latest definitions instead of
   * silently skipping rows that already exist.
   */
  upsertByCode(createFeatureDto: CreateFeatureDto) {
    const data: any = {
      name: createFeatureDto.name,
      description: createFeatureDto.description,
      type: createFeatureDto.type,
      category: createFeatureDto.category,
      icon: createFeatureDto.icon,
      display_order: createFeatureDto.displayOrder,
      price_monthly: createFeatureDto.priceMonthly,
      is_active: createFeatureDto.isActive !== undefined ? (createFeatureDto.isActive ? 1 : 0) : 1,
    };
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.features.upsert({
      where: { code: createFeatureDto.code },
      update: data,
      create: { code: createFeatureDto.code, ...data },
    });
  }

  remove(id: string) {
    return this.prisma.features.delete({
      where: { id },
    });
  }
}
