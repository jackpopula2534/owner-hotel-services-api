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
      price_monthly: createFeatureDto.priceMonthly,
      is_active: createFeatureDto.isActive !== undefined ? (createFeatureDto.isActive ? 1 : 0) : 1,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.features.create({
      data,
    });
  }

  findAll() {
    return this.prisma.features.findMany({
      where: { is_active: 1 },
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
      price_monthly: updateFeatureDto.priceMonthly,
      is_active: updateFeatureDto.isActive !== undefined ? (updateFeatureDto.isActive ? 1 : 0) : undefined,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.features.update({
      where: { id },
      data,
    });
  }

  remove(id: string) {
    return this.prisma.features.delete({
      where: { id },
    });
  }
}


