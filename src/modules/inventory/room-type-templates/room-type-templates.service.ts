import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRoomTypeTemplateDto } from './dto/create-room-type-template.dto';
import { UpdateRoomTypeTemplateDto } from './dto/update-room-type-template.dto';
import { BulkCreateTemplateDto } from './dto/bulk-create-template.dto';

interface TemplateWithItemDetails {
  id: string;
  tenantId: string;
  roomType: string;
  taskType: string;
  itemId: string;
  itemName?: string;
  itemSku?: string;
  quantity: number;
  warehouseId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface GroupedTemplates {
  [roomType: string]: {
    [taskType: string]: TemplateWithItemDetails[];
  };
}

@Injectable()
export class RoomTypeTemplatesService {
  private readonly logger = new Logger(RoomTypeTemplatesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Find templates by room type, optionally filtered by task type
   */
  async findByRoomType(
    tenantId: string,
    roomType: string,
    taskType?: string,
  ): Promise<TemplateWithItemDetails[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!roomType) {
      throw new BadRequestException('Room type is required');
    }

    try {
      const where: any = {
        tenantId,
        roomType,
      };

      if (taskType) {
        where.taskType = taskType;
      }

      const templates = await this.prisma.roomTypeAmenityTemplate.findMany({
        where,
        orderBy: [{ taskType: 'asc' }, { createdAt: 'asc' }],
      });

      return templates.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        roomType: t.roomType,
        taskType: t.taskType,
        itemId: t.itemId,
        quantity: t.quantity,
        warehouseId: t.warehouseId || undefined,
        notes: t.notes || undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    } catch (error) {
      this.logger.error(`Error finding templates for room type ${roomType}:`, error);
      throw error;
    }
  }

  /**
   * Get all templates grouped by room type and task type
   */
  async findAll(tenantId: string): Promise<GroupedTemplates> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      const templates = await this.prisma.roomTypeAmenityTemplate.findMany({
        where: { tenantId },
        orderBy: [{ roomType: 'asc' }, { taskType: 'asc' }, { createdAt: 'asc' }],
      });

      const grouped: GroupedTemplates = {};

      for (const template of templates) {
        if (!grouped[template.roomType]) {
          grouped[template.roomType] = {};
        }

        if (!grouped[template.roomType][template.taskType]) {
          grouped[template.roomType][template.taskType] = [];
        }

        grouped[template.roomType][template.taskType].push({
          id: template.id,
          tenantId: template.tenantId,
          roomType: template.roomType,
          taskType: template.taskType,
          itemId: template.itemId,
          quantity: template.quantity,
          warehouseId: template.warehouseId || undefined,
          notes: template.notes || undefined,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        });
      }

      return grouped;
    } catch (error) {
      this.logger.error('Error finding all templates:', error);
      throw error;
    }
  }

  /**
   * Create a single template
   */
  async create(dto: CreateRoomTypeTemplateDto, tenantId: string): Promise<TemplateWithItemDetails> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      // Check if template already exists
      const existing = await this.prisma.roomTypeAmenityTemplate.findFirst({
        where: {
          tenantId,
          roomType: dto.roomType,
          taskType: dto.taskType || 'checkout',
          itemId: dto.itemId,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Template already exists for room type ${dto.roomType}, task type ${dto.taskType || 'checkout'}, and item ${dto.itemId}`,
        );
      }

      const template = await this.prisma.roomTypeAmenityTemplate.create({
        data: {
          tenantId,
          roomType: dto.roomType,
          taskType: dto.taskType || 'checkout',
          itemId: dto.itemId,
          quantity: dto.quantity,
          warehouseId: dto.warehouseId || null,
          notes: dto.notes || null,
        },
      });

      return {
        id: template.id,
        tenantId: template.tenantId,
        roomType: template.roomType,
        taskType: template.taskType,
        itemId: template.itemId,
        quantity: template.quantity,
        warehouseId: template.warehouseId || undefined,
        notes: template.notes || undefined,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };
    } catch (error) {
      this.logger.error('Error creating template:', error);
      throw error;
    }
  }

  /**
   * Bulk create/replace templates for a room type
   * Deletes existing templates for the same room type + task type first
   */
  async bulkCreate(
    dto: BulkCreateTemplateDto,
    tenantId: string,
  ): Promise<TemplateWithItemDetails[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Items array is required and must not be empty');
    }

    try {
      const createdTemplates = await this.prisma.$transaction(async (tx) => {
        // Delete existing templates for same room type + task type
        await tx.roomTypeAmenityTemplate.deleteMany({
          where: {
            tenantId,
            roomType: dto.roomType,
            taskType: dto.taskType || 'checkout',
          },
        });

        // Create new templates
        const templates = await Promise.all(
          dto.items.map((item) =>
            tx.roomTypeAmenityTemplate.create({
              data: {
                tenantId,
                roomType: dto.roomType,
                taskType: dto.taskType || 'checkout',
                itemId: item.itemId,
                quantity: item.quantity,
                warehouseId: item.warehouseId || null,
                notes: item.notes || null,
              },
            }),
          ),
        );

        return templates;
      });

      return createdTemplates.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        roomType: t.roomType,
        taskType: t.taskType,
        itemId: t.itemId,
        quantity: t.quantity,
        warehouseId: t.warehouseId || undefined,
        notes: t.notes || undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    } catch (error) {
      this.logger.error('Error in bulk create:', error);
      throw error;
    }
  }

  /**
   * Update a template
   * Note: roomType, taskType, and itemId cannot be changed
   */
  async update(
    id: string,
    dto: UpdateRoomTypeTemplateDto,
    tenantId: string,
  ): Promise<TemplateWithItemDetails> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Template ID is required');
    }

    try {
      const template = await this.prisma.roomTypeAmenityTemplate.findUnique({
        where: { id },
      });

      if (!template) {
        throw new NotFoundException(`Template with ID ${id} not found`);
      }

      if (template.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      // Prevent changing roomType, taskType, or itemId
      if (dto.roomType !== undefined || dto.taskType !== undefined || dto.itemId !== undefined) {
        throw new BadRequestException('Cannot modify roomType, taskType, or itemId');
      }

      const updated = await this.prisma.roomTypeAmenityTemplate.update({
        where: { id },
        data: {
          quantity: dto.quantity !== undefined ? dto.quantity : template.quantity,
          warehouseId: dto.warehouseId !== undefined ? dto.warehouseId : template.warehouseId,
          notes: dto.notes !== undefined ? dto.notes : template.notes,
        },
      });

      return {
        id: updated.id,
        tenantId: updated.tenantId,
        roomType: updated.roomType,
        taskType: updated.taskType,
        itemId: updated.itemId,
        quantity: updated.quantity,
        warehouseId: updated.warehouseId || undefined,
        notes: updated.notes || undefined,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Error updating template ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a template
   */
  async remove(id: string, tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Template ID is required');
    }

    try {
      const template = await this.prisma.roomTypeAmenityTemplate.findUnique({
        where: { id },
      });

      if (!template) {
        throw new NotFoundException(`Template with ID ${id} not found`);
      }

      if (template.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      await this.prisma.roomTypeAmenityTemplate.delete({
        where: { id },
      });
    } catch (error) {
      this.logger.error(`Error deleting template ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get distinct room types that have templates configured
   */
  async getRoomTypes(tenantId: string): Promise<string[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      const roomTypes = await this.prisma.roomTypeAmenityTemplate.findMany({
        where: { tenantId },
        distinct: ['roomType'],
        select: { roomType: true },
        orderBy: { roomType: 'asc' },
      });

      return roomTypes.map((rt) => rt.roomType);
    } catch (error) {
      this.logger.error('Error getting room types:', error);
      throw error;
    }
  }

  /**
   * Copy templates from one room type to another
   */
  async copyTemplate(
    tenantId: string,
    fromRoomType: string,
    toRoomType: string,
    taskType?: string,
  ): Promise<TemplateWithItemDetails[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!fromRoomType || !toRoomType) {
      throw new BadRequestException('Source and target room types are required');
    }

    if (fromRoomType === toRoomType) {
      throw new BadRequestException('Source and target room types cannot be the same');
    }

    try {
      // Get source templates
      const sourceTemplates = await this.prisma.roomTypeAmenityTemplate.findMany({
        where: {
          tenantId,
          roomType: fromRoomType,
          ...(taskType && { taskType }),
        },
      });

      if (sourceTemplates.length === 0) {
        throw new NotFoundException(
          `No templates found for room type ${fromRoomType}${taskType ? ` and task type ${taskType}` : ''}`,
        );
      }

      // Copy templates using transaction
      const copiedTemplates = await this.prisma.$transaction(async (tx) => {
        return Promise.all(
          sourceTemplates.map((source) =>
            tx.roomTypeAmenityTemplate.create({
              data: {
                tenantId,
                roomType: toRoomType,
                taskType: source.taskType,
                itemId: source.itemId,
                quantity: source.quantity,
                warehouseId: source.warehouseId,
                notes: source.notes,
              },
            }),
          ),
        );
      });

      return copiedTemplates.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        roomType: t.roomType,
        taskType: t.taskType,
        itemId: t.itemId,
        quantity: t.quantity,
        warehouseId: t.warehouseId || undefined,
        notes: t.notes || undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    } catch (error) {
      this.logger.error(`Error copying templates from ${fromRoomType} to ${toRoomType}:`, error);
      throw error;
    }
  }
}
