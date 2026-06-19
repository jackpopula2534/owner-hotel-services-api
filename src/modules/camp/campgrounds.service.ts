import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehousesService } from '../inventory/warehouses/warehouses.service';
import { WarehouseType } from '../inventory/warehouses/dto/create-warehouse.dto';
import {
  CreateCampgroundDto,
  UpdateCampgroundDto,
  UploadMapDto,
} from './dto/campground.dto';

@Injectable()
export class CampgroundsService {
  private readonly logger = new Logger(CampgroundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouses: WarehousesService,
  ) {}

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

  /** เพิ่มรูปภาพเข้าคลังรูปของลาน (append) — จำกัดสูงสุด 12 รูป */
  async addImages(id: string, urls: string[], tenantId?: string) {
    const existing = await this.prisma.campground.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, images: true },
    });
    if (!existing) {
      throw new NotFoundException(`Campground ${id} not found`);
    }
    const current = Array.isArray(existing.images)
      ? (existing.images as string[])
      : [];
    const merged = [...current, ...urls].slice(0, 12);
    const data = await this.prisma.campground.update({
      where: { id },
      data: { images: merged },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campground.delete({ where: { id } });
    return { success: true };
  }

  /**
   * เชื่อมลานเข้ากับ Inventory Module — ถ้ายังไม่มีคลังย่อยของลาน จะ Auto-Create ให้
   * คลังถูกผูกกับ default property ของ tenant (Warehouse ต้องมี propertyId)
   */
  async connectInventory(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('ต้องระบุ tenant');
    }
    const campground = await this.prisma.campground.findFirst({
      where: { id, tenantId },
    });
    if (!campground) {
      throw new NotFoundException(`Campground ${id} not found`);
    }

    // เชื่อมอยู่แล้ว + คลังยังมีจริง → คืนค่าเดิม
    if (campground.warehouseId) {
      const existing = await this.prisma.warehouse.findFirst({
        where: { id: campground.warehouseId, tenantId, deletedAt: null },
      });
      if (existing) {
        return {
          success: true,
          data: { campground, warehouse: existing, created: false },
        };
      }
    }

    // หา property ของ tenant (default ก่อน แล้วค่อย fallback อันแรก)
    const property = await this.prisma.property.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (!property) {
      throw new BadRequestException(
        'ยังไม่มีโรงแรม/พร็อพเพอร์ตี้ในระบบ — สร้างพร็อพเพอร์ตี้ก่อนจึงจะสร้างคลังได้',
      );
    }

    const code = `CAMP-${campground.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    // กรณี disconnect แล้วเชื่อมใหม่: คลังเดิม (code เดียวกัน) ยังอยู่ — re-link ไม่สร้างซ้ำ
    const existingByCode = await this.prisma.warehouse.findFirst({
      where: { tenantId, code, deletedAt: null },
    });

    const warehouse =
      existingByCode ??
      (await this.warehouses.create(
        {
          name: `คลังลาน: ${campground.name}`.slice(0, 100),
          code,
          propertyId: property.id,
          type: WarehouseType.GENERAL,
          location: campground.address ?? undefined,
          isDefault: false,
        },
        tenantId,
      ));

    const updated = await this.prisma.campground.update({
      where: { id },
      data: { warehouseId: warehouse.id },
    });
    this.logger.log(
      `Campground ${id} connected to warehouse ${warehouse.id} (${code})` +
        (existingByCode ? ' [re-linked existing]' : ' [created]'),
    );
    return {
      success: true,
      data: { campground: updated, warehouse, created: !existingByCode },
    };
  }

  /** ยกเลิกการเชื่อมคลัง (ไม่ลบคลัง เก็บประวัติ stock ไว้) */
  async disconnectInventory(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campground.update({
      where: { id },
      data: { warehouseId: null },
    });
    return { success: true, data };
  }

  /**
   * กดเชื่อม/ยกเลิกการเชื่อมระบบ POS หรือระบบครัว (KDS) ให้ลานนี้ — เก็บ state แยกตามลาน
   * (ผู้ใช้ต้องกดเชื่อมเองทุกครั้ง ไม่เชื่อมอัตโนมัติ) สิทธิ์ add-on POS_MODULE ตรวจที่ฝั่ง UI
   */
  async connectPos(id: string, tenantId?: string) {
    return this.setConnectionField(id, 'posConnectedAt', new Date(), tenantId);
  }

  async disconnectPos(id: string, tenantId?: string) {
    return this.setConnectionField(id, 'posConnectedAt', null, tenantId);
  }

  async connectKitchen(id: string, tenantId?: string) {
    return this.setConnectionField(id, 'kitchenConnectedAt', new Date(), tenantId);
  }

  async disconnectKitchen(id: string, tenantId?: string) {
    return this.setConnectionField(id, 'kitchenConnectedAt', null, tenantId);
  }

  private async setConnectionField(
    id: string,
    field: 'posConnectedAt' | 'kitchenConnectedAt',
    value: Date | null,
    tenantId?: string,
  ) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.campground.update({
      where: { id },
      data: { [field]: value },
    });
    this.logger.log(
      `Campground ${id} ${field} ${value ? 'connected' : 'disconnected'}`,
    );
    return { success: true, data };
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
