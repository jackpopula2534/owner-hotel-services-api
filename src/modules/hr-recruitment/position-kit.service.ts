import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { UpdatePositionKitDto } from './dto/recruitment.dto';

export interface PositionKitItem {
  itemId?: string;
  name: string;
  qty: number;
  note?: string;
}

/** ชุดอุปกรณ์มาตรฐานของตำแหน่ง — ใช้เติมใบขอเบิกของพนักงานใหม่อัตโนมัติ */
@Injectable()
export class PositionKitService {
  private readonly logger = new Logger(PositionKitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async findPosition(positionId: string, tenantId: string): Promise<{ id: string; equipmentKit: unknown }> {
    const position = await (this.prisma as any).hrPosition.findFirst({
      where: { id: positionId, tenantId },
      select: { id: true, equipmentKit: true },
    });
    if (!position) throw new NotFoundException(`Position ${positionId} not found`);
    return position;
  }

  async get(positionId: string, tenantId: string): Promise<{ positionId: string; items: PositionKitItem[] }> {
    const position = await this.findPosition(positionId, tenantId);
    const items = Array.isArray(position.equipmentKit) ? (position.equipmentKit as PositionKitItem[]) : [];
    return { positionId, items };
  }

  async update(
    positionId: string,
    dto: UpdatePositionKitDto,
    tenantId: string,
    userId: string,
  ): Promise<{ positionId: string; items: PositionKitItem[] }> {
    await this.findPosition(positionId, tenantId);

    const itemIds = [...new Set(dto.items.map((i) => i.itemId).filter((v): v is string => !!v))];
    if (itemIds.length) {
      const owned = await (this.prisma as any).inventoryItem.count({ where: { tenantId, id: { in: itemIds } } });
      if (owned !== itemIds.length) throw new BadRequestException('Some itemId values are not inventory items of this organization');
    }

    const items: PositionKitItem[] = dto.items.map((i) => ({
      ...(i.itemId && { itemId: i.itemId }),
      name: i.name.trim(),
      qty: i.qty,
      ...(i.note?.trim() && { note: i.note.trim() }),
    }));
    await (this.prisma as any).hrPosition.update({ where: { id: positionId }, data: { equipmentKit: items } });

    this.auditLog
      .log({
        action: AuditAction.POSITION_KIT_UPDATE,
        resource: AuditResource.EMPLOYEE,
        resourceId: positionId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues: { items },
        description: `Position equipment kit updated (${items.length} item(s))`,
      })
      .catch((err: Error) => this.logger.error(`Audit log failed: ${err.message}`));
    return { positionId, items };
  }
}
