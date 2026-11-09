import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';

@Injectable()
export class ZonesService {
  private readonly logger = new Logger(ZonesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(campgroundId: string, tenantId?: string) {
    const data = await this.prisma.campZone.findMany({
      where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { pitches: true } } },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const zone = await this.prisma.campZone.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { pitches: true },
    });
    if (!zone) {
      throw new NotFoundException(`Zone ${id} not found`);
    }
    return { success: true, data: zone };
  }

  async create(dto: CreateZoneDto, tenantId?: string) {
    const data = await this.prisma.campZone.create({
      data: { ...dto, tenantId: tenantId ?? null } as unknown as Prisma.CampZoneUncheckedCreateInput,
    });
    this.logger.log(`Zone created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdateZoneDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campZone.update({
      where: { id },
      data: { ...dto } as unknown as Prisma.CampZoneUncheckedUpdateInput,
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campZone.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campZone.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Zone ${id} not found`);
    }
  }
}
