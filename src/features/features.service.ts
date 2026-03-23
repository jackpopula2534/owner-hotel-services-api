import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeatureDto } from './dto/create-feature.dto';
import { UpdateFeatureDto } from './dto/update-feature.dto';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createFeatureDto: CreateFeatureDto) {
    return this.prisma.features.create({
      data: createFeatureDto as any,
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
    return this.prisma.features.update({
      where: { id },
      data: updateFeatureDto,
    });
  }

  remove(id: string) {
    return this.prisma.features.delete({
      where: { id },
    });
  }
}


