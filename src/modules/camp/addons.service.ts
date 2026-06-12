import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddonDto, UpdateAddonDto } from './dto/addon.dto';

@Injectable()
export class AddonsService {
  private readonly logger = new Logger(AddonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(campgroundId: string, tenantId?: string) {
    const data = await this.prisma.campAddon.findMany({
      where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const addon = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!addon) {
      throw new NotFoundException(`Addon ${id} not found`);
    }
    return { success: true, data: addon };
  }

  async create(dto: CreateAddonDto, tenantId?: string) {
    const data = await this.prisma.campAddon.create({
      data: { ...dto, tenantId: tenantId ?? null },
    });
    this.logger.log(`Addon created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdateAddonDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campAddon.update({
      where: { id },
      data: { ...dto },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campAddon.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Addon ${id} not found`);
    }
  }
}
