import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCampgroundDto,
  UpdateCampgroundDto,
  UploadMapDto,
} from './dto/campground.dto';

@Injectable()
export class CampgroundsService {
  private readonly logger = new Logger(CampgroundsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId?: string) {
    if (!tenantId) {
      return { success: true, data: [] };
    }
    const data = await this.prisma.campground.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { zones: true, pitches: true } },
      },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const campground = await this.prisma.campground.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: {
        zones: true,
        pitches: { include: { zone: true } },
      },
    });
    if (!campground) {
      throw new NotFoundException(`Campground ${id} not found`);
    }
    return { success: true, data: campground };
  }

  async create(dto: CreateCampgroundDto, tenantId?: string) {
    const data = await this.prisma.campground.create({
      data: { ...dto, tenantId: tenantId ?? null },
    });
    this.logger.log(`Campground created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdateCampgroundDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campground.update({
      where: { id },
      data: { ...dto },
    });
    return { success: true, data };
  }

  async setMap(id: string, dto: UploadMapDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campground.update({
      where: { id },
      data: {
        mapImageUrl: dto.mapImageUrl,
        mapWidth: dto.mapWidth ?? null,
        mapHeight: dto.mapHeight ?? null,
      },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campground.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campground.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Campground ${id} not found`);
    }
  }
}
