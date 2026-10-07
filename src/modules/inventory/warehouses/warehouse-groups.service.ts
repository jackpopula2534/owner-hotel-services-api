import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWarehouseGroupDto, UpdateWarehouseGroupDto } from './dto/warehouse-group.dto';
import { parseChannels } from './warehouse-channel';

const GROUP_INCLUDE = {
  warehouses: {
    where: { deletedAt: null },
    select: { id: true, name: true, code: true, type: true, isActive: true },
    orderBy: { name: 'asc' },
  },
} satisfies Prisma.WarehouseGroupInclude;

type GroupRow = Prisma.WarehouseGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

@Injectable()
export class WarehouseGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const rows = await this.prisma.warehouseGroup.findMany({
      where: { tenantId },
      include: GROUP_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toView);
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.prisma.warehouseGroup.findFirst({
      where: { id, tenantId },
      include: GROUP_INCLUDE,
    });
    if (!row) throw new NotFoundException('ไม่พบกลุ่มคลังนี้');
    return toView(row);
  }

  async create(dto: CreateWarehouseGroupDto, tenantId: string) {
    const code = dto.code.trim().toUpperCase();
    await this.assertCodeFree(tenantId, code);
    await this.assertWarehousesOwned(tenantId, dto.warehouseIds);

    const id = await this.prisma.$transaction(async (tx) => {
      const group = await tx.warehouseGroup.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          code,
          description: dto.description?.trim() || null,
          channels: dto.channels,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        select: { id: true },
      });
      if (dto.warehouseIds?.length) {
        await tx.warehouse.updateMany({
          where: { tenantId, id: { in: dto.warehouseIds } },
          data: { groupId: group.id },
        });
      }
      return group.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(id: string, dto: UpdateWarehouseGroupDto, tenantId: string) {
    const current = await this.findOne(id, tenantId);
    const code = dto.code?.trim().toUpperCase();
    if (code && code !== current.code) await this.assertCodeFree(tenantId, code, id);
    await this.assertWarehousesOwned(tenantId, dto.warehouseIds);

    await this.prisma.$transaction(async (tx) => {
      await tx.warehouseGroup.updateMany({
        where: { id, tenantId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(code && { code }),
          ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
          ...(dto.channels !== undefined && { channels: dto.channels }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
      if (dto.warehouseIds !== undefined) {
        // แทนที่ทั้งชุด: คลังที่ถูกเอาออกกลับไปเป็น "ไม่มีกลุ่ม" (แสดงทุกระบบ)
        await tx.warehouse.updateMany({
          where: { tenantId, groupId: id, id: { notIn: dto.warehouseIds } },
          data: { groupId: null },
        });
        if (dto.warehouseIds.length) {
          await tx.warehouse.updateMany({
            where: { tenantId, id: { in: dto.warehouseIds } },
            data: { groupId: id },
          });
        }
      }
    });
    return this.findOne(id, tenantId);
  }

  /** ลบกลุ่ม — คลังในกลุ่มไม่ถูกลบ แค่กลับไปเป็น "ไม่มีกลุ่ม" */
  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    await this.prisma.$transaction([
      this.prisma.warehouse.updateMany({
        where: { tenantId, groupId: id },
        data: { groupId: null },
      }),
      this.prisma.warehouseGroup.deleteMany({ where: { id, tenantId } }),
    ]);
  }

  private async assertCodeFree(tenantId: string, code: string, exceptId?: string) {
    const dup = await this.prisma.warehouseGroup.findFirst({
      where: { tenantId, code, ...(exceptId && { id: { not: exceptId } }) },
      select: { id: true },
    });
    if (dup) throw new ConflictException(`รหัสกลุ่ม ${code} ถูกใช้แล้ว`);
  }

  private async assertWarehousesOwned(tenantId: string, ids?: string[]) {
    if (!ids?.length) return;
    const found = await this.prisma.warehouse.count({
      where: { tenantId, deletedAt: null, id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException('มีคลังที่ไม่พบ หรือไม่ได้อยู่ในองค์กรของคุณ');
    }
  }
}

function toView(row: GroupRow) {
  return { ...row, channels: parseChannels(row.channels) };
}
