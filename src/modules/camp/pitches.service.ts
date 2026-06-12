import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreatePitchDto,
  UpdatePitchDto,
  UpdatePitchPositionDto,
} from './dto/pitch.dto';

const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];

@Injectable()
export class PitchesService {
  private readonly logger = new Logger(PitchesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(campgroundId: string, tenantId?: string) {
    const data = await this.prisma.campPitch.findMany({
      where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
      orderBy: { code: 'asc' },
      include: { zone: { select: { id: true, name: true, type: true, color: true } } },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const pitch = await this.prisma.campPitch.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { zone: true },
    });
    if (!pitch) {
      throw new NotFoundException(`Pitch ${id} not found`);
    }
    return { success: true, data: pitch };
  }

  async create(dto: CreatePitchDto, tenantId?: string) {
    const data = await this.prisma.campPitch.create({
      data: { ...dto, tenantId: tenantId ?? null },
    });
    this.logger.log(`Pitch created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdatePitchDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campPitch.update({
      where: { id },
      data: { ...dto },
    });
    return { success: true, data };
  }

  async updatePosition(id: string, dto: UpdatePitchPositionDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campPitch.update({
      where: { id },
      data: { posX: dto.posX, posY: dto.posY },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campPitch.delete({ where: { id } });
    return { success: true };
  }

  /**
   * คืน pitch ทั้งหมดในลานพร้อมธง available สำหรับช่วงวันที่ระบุ
   * จุดจะ "ไม่ว่าง" ถ้ามี reservation ที่ทับช่วงเวลาและสถานะ blocking
   */
  async availability(
    campgroundId: string,
    checkIn: string,
    checkOut: string,
    tenantId?: string,
  ) {
    const start = new Date(checkIn);
    const end = new Date(checkOut);

    const [pitches, overlapping] = await Promise.all([
      this.prisma.campPitch.findMany({
        where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
        include: { zone: { select: { id: true, name: true, type: true, color: true, basePrice: true } } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.campReservation.findMany({
        where: {
          campgroundId,
          ...(tenantId ? { tenantId } : {}),
          status: { in: BLOCKING_STATUSES },
          // overlap: existing.checkIn < end AND existing.checkOut > start
          checkIn: { lt: end },
          checkOut: { gt: start },
        },
        select: { pitchId: true },
      }),
    ]);

    const bookedPitchIds = new Set(overlapping.map((r) => r.pitchId));
    const data = pitches.map((pitch) => ({
      ...pitch,
      available: pitch.status === 'available' && !bookedPitchIds.has(pitch.id),
    }));

    return { success: true, data };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campPitch.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Pitch ${id} not found`);
    }
  }
}
