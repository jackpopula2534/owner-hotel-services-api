import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RestaurantService {
  private readonly logger = new Logger(RestaurantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: {
      page?: number;
      limit?: number;
      search?: string;
      isActive?: string;
      propertyId?: string;
      hotelId?: string;
    },
    tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { page = 1, limit = 10, search, isActive, propertyId, hotelId } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, any> = { tenantId };

    // Support both propertyId and hotelId (frontend uses hotelId)
    const pId = propertyId || hotelId;
    if (pId) {
      where.propertyId = pId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { description: { contains: search } },
        { location: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      (this.prisma.restaurant as any).findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tables: true, menuCategories: true, orders: true } },
          property: { select: { id: true, name: true } },
        },
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const restaurant = await (this.prisma.restaurant as any).findFirst({
      where: { id, tenantId },
      include: {
        property: { select: { id: true, name: true } },
        tables: {
          where: { isActive: true },
          orderBy: { tableNumber: 'asc' },
        },
        menuCategories: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            items: {
              where: { isAvailable: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${id} not found`);
    }

    return restaurant;
  }

  async create(createRestaurantDto: CreateRestaurantDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const code = createRestaurantDto.code || (await this.nextCode(tenantId));

    const existing = await this.prisma.restaurant.findFirst({
      where: { code, tenantId },
    });

    if (existing) {
      throw new BadRequestException(`มีร้านอาหารรหัส '${code}' อยู่แล้ว`);
    }

    const { layoutData, ...rest } = createRestaurantDto;
    // ฟอร์มที่ไม่ได้เลือกคลังส่ง '' มา — ต้องแปลว่า "ไม่ผูก" ไม่ใช่ปล่อยไปชน FK เป็น 500
    if (rest.warehouseId === '') rest.warehouseId = null;
    await this.assertWarehouse(tenantId, rest.warehouseId);

    try {
      return await (this.prisma.restaurant as any).create({
        data: {
          ...rest,
          code,
          tenantId,
          ...(layoutData !== undefined && { layoutData: layoutData as any }),
        },
      });
    } catch (error) {
      // Two people creating at once land on the same generated code. The check
      // above cannot see that, so translate the constraint rather than letting
      // `restaurants_tenantId_code_key` reach the screen.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(`มีร้านอาหารรหัส '${code}' อยู่แล้ว กรุณาลองใหม่อีกครั้ง`);
      }
      throw error;
    }
  }

  /**
   * Next free `RES-###` for this tenant. Counts up from the highest code in
   * use rather than from how many restaurants exist — deleting one used to
   * make the generator hand out a number that was already taken.
   */
  private async nextCode(tenantId: string): Promise<string> {
    const taken = await this.prisma.restaurant.findMany({
      where: { tenantId },
      select: { code: true },
    });

    const highest = taken.reduce((max, row) => {
      const match = /^RES-(\d+)$/.exec(row.code ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return `RES-${String(highest + 1).padStart(3, '0')}`;
  }

  async update(id: string, updateRestaurantDto: UpdateRestaurantDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    const { layoutData, ...rest } = updateRestaurantDto;
    if (rest.warehouseId === '') rest.warehouseId = null;
    await this.assertWarehouse(tenantId, rest.warehouseId);

    return this.prisma.restaurant.update({
      where: { id },
      data: {
        ...rest,
        ...(layoutData !== undefined && { layoutData: layoutData as any }),
      },
    });
  }

  /**
   * คลังต้นทางต้องเป็นคลังของ tenant นี้เท่านั้น
   *
   * ถ้าปล่อยให้ตั้งเป็น id ที่ไม่ใช่ของตัวเอง การตัดสต๊อกตอนปิดบิลจะเงียบ ๆ
   * ตกไปใช้คลังสำรองแทน (มีการตรวจ tenant อีกชั้นที่นั่น) แล้วคนตั้งค่าจะไม่รู้เลย
   * ว่าที่ตั้งไว้ไม่มีผล — จึงต้องด่าตั้งแต่ตอนบันทึก
   */
  private async assertWarehouse(
    tenantId: string | undefined,
    warehouseId?: string | null,
  ): Promise<void> {
    if (!warehouseId) return;
    // ไม่มี tenant = ตรวจความเป็นเจ้าของไม่ได้ ต้องปฏิเสธ ไม่ใช่ปล่อยผ่านให้ชนคลังของคนอื่น
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException('ไม่พบคลังสินค้าที่เลือก');
    }
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.restaurant.delete({ where: { id } });
  }
}
