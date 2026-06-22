import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFacilityDto, UpdateFacilityDto } from './dto/facility.dto';

@Injectable()
export class FacilitiesService {
  private readonly logger = new Logger(FacilitiesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(campgroundId: string, tenantId?: string) {
    const data = await this.prisma.campFacility.findMany({
      where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const facility = await this.prisma.campFacility.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!facility) {
      throw new NotFoundException(`Facility ${id} not found`);
    }
    return { success: true, data: facility };
  }

  async create(dto: CreateFacilityDto, tenantId?: string) {
    const data = await this.prisma.campFacility.create({
      data: { ...dto, tenantId: tenantId ?? null },
    });
    this.logger.log(`Facility created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdateFacilityDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campFacility.update({
      where: { id },
      data: { ...dto },
    });
    return { success: true, data };
  }

  async updatePosition(id: string, posX: number, posY: number, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campFacility.update({
      where: { id },
      data: { posX, posY },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campFacility.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campFacility.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Facility ${id} not found`);
    }
  }
}
