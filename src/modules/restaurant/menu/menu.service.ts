import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Menu Categories ──────────────────────────────────────────────────────

  async findAllCategories(restaurantId: string, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    return this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: { select: { items: true } },
      },
    });
  }

  async createCategory(
    restaurantId: string,
    dto: CreateMenuCategoryDto,
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const maxOrder = await this.prisma.menuCategory.aggregate({
      where: { restaurantId, tenantId },
      _max: { displayOrder: true },
    });

    const displayOrder = dto.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1;

    return this.prisma.menuCategory.create({
      data: { ...dto, displayOrder, restaurantId, tenantId },
    });
  }

  async updateCategory(
    restaurantId: string,
    categoryId: string,
    dto: UpdateMenuCategoryDto,
    tenantId: string,
  ) {
    await this.findCategoryOrFail(categoryId, restaurantId, tenantId);

    return this.prisma.menuCategory.update({
      where: { id: categoryId },
      data: dto,
    });
  }

  async removeCategory(restaurantId: string, categoryId: string, tenantId: string) {
    await this.findCategoryOrFail(categoryId, restaurantId, tenantId);

    const itemCount = await this.prisma.menuItem.count({
      where: { categoryId, isAvailable: true },
    });

    if (itemCount > 0) {
      throw new BadRequestException(
        `Cannot delete category with ${itemCount} active menu items. Deactivate items first.`,
      );
    }

    await this.prisma.menuCategory.delete({ where: { id: categoryId } });
  }

  async reorderCategories(
    restaurantId: string,
    dto: ReorderCategoriesDto,
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    await this.prisma.$transaction(
      dto.categories.map(({ id, displayOrder }) =>
        this.prisma.menuCategory.updateMany({
          where: { id, restaurantId, tenantId },
          data: { displayOrder },
        }),
      ),
    );

    return this.findAllCategories(restaurantId, tenantId);
  }

  // ─── Menu Items ───────────────────────────────────────────────────────────

  async findAllItems(
    restaurantId: string,
    query: {
      categoryId?: string;
      isAvailable?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const { categoryId, isAvailable, search, page = 1, limit = 50 } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };

    if (categoryId) where.categoryId = categoryId;
    if (isAvailable !== undefined) where.isAvailable = isAvailable === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.menuItem.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        include: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.menuItem.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOneItem(restaurantId: string, itemId: string, tenantId: string) {
    const item = await this.prisma.menuItem.findFirst({
      where: { id: itemId, restaurantId, tenantId },
      include: { category: true },
    });

    if (!item) {
      throw new NotFoundException(`Menu item with ID ${itemId} not found`);
    }

    return item;
  }

  async createItem(restaurantId: string, dto: CreateMenuItemDto, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);
    await this.findCategoryOrFail(dto.categoryId, restaurantId, tenantId);

    const maxOrder = await this.prisma.menuItem.aggregate({
      where: { categoryId: dto.categoryId, tenantId },
      _max: { displayOrder: true },
    });

    const displayOrder = dto.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1;

    return this.prisma.menuItem.create({
      data: {
        ...dto,
        price: dto.price,
        cost: dto.cost,
        allergens: dto.allergens ? JSON.stringify(dto.allergens) : undefined,
        displayOrder,
        restaurantId,
        tenantId,
      },
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async updateItem(
    restaurantId: string,
    itemId: string,
    dto: UpdateMenuItemDto,
    tenantId: string,
  ) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    if (dto.categoryId) {
      await this.findCategoryOrFail(dto.categoryId, restaurantId, tenantId);
    }

    return this.prisma.menuItem.update({
      where: { id: itemId },
      data: {
        ...dto,
        allergens: dto.allergens ? JSON.stringify(dto.allergens) : undefined,
      },
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async toggleAvailability(
    restaurantId: string,
    itemId: string,
    isAvailable: boolean,
    tenantId: string,
  ) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    return this.prisma.menuItem.update({
      where: { id: itemId },
      data: { isAvailable },
    });
  }

  async removeItem(restaurantId: string, itemId: string, tenantId: string) {
    await this.findOneItem(restaurantId, itemId, tenantId);

    await this.prisma.menuItem.delete({ where: { id: itemId } });
  }

  // ─── Full Menu ────────────────────────────────────────────────────────────

  async getFullMenu(restaurantId: string, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    return this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async validateRestaurant(restaurantId: string, tenantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${restaurantId} not found`);
    }

    return restaurant;
  }

  private async findCategoryOrFail(
    categoryId: string,
    restaurantId: string,
    tenantId: string,
  ) {
    const category = await this.prisma.menuCategory.findFirst({
      where: { id: categoryId, restaurantId, tenantId },
    });

    if (!category) {
      throw new NotFoundException(`Menu category with ID ${categoryId} not found`);
    }

    return category;
  }
}
