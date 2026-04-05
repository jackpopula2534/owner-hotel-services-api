import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMaintenanceTaskDto } from './dto/create-maintenance-task.dto';
import { UpdateMaintenanceTaskDto, MaintenanceTaskStatus } from './dto/update-maintenance-task.dto';

interface MaintenanceQuery {
  status?: string;
  category?: string;
  priority?: string;
  propertyId?: string;
  roomId?: string;
  page?: number;
  limit?: number;
}

interface DashboardData {
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  totalEstimatedCost: number;
  totalActualCost: number;
  byCategory: Array<{
    category: string;
    count: number;
    cost: number;
  }>;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all maintenance tasks with filtering and pagination
   */
  async findAll(
    query: MaintenanceQuery,
    tenantId: string,
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.category) {
      where.category = query.category;
    }

    if (query.priority) {
      where.priority = query.priority;
    }

    if (query.propertyId) {
      where.propertyId = query.propertyId;
    }

    if (query.roomId) {
      where.roomId = query.roomId;
    }

    try {
      const [tasks, total] = await Promise.all([
        this.prisma.maintenanceTask.findMany({
          where,
          skip,
          take: limit,
          include: {
            assignedTo: true,
            inspectedBy: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.maintenanceTask.count({ where }),
      ]);

      return { data: tasks, total, page, limit };
    } catch (error) {
      this.logger.error(`Failed to fetch maintenance tasks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a single maintenance task by ID
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      const task = await this.prisma.maintenanceTask.findFirst({
        where: { id, tenantId },
        include: {
          property: true,
          room: true,
          assignedTo: true,
          inspectedBy: true,
        },
      });

      if (!task) {
        throw new NotFoundException(`Maintenance task with ID ${id} not found`);
      }

      return task;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch maintenance task ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new maintenance task
   */
  async create(dto: CreateMaintenanceTaskDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify property exists
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, tenantId },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${dto.propertyId} not found`);
    }

    // Verify room exists (if provided)
    if (dto.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: dto.roomId, propertyId: dto.propertyId },
      });

      if (!room) {
        throw new NotFoundException(`Room with ID ${dto.roomId} not found in this property`);
      }
    }

    try {
      const task = await this.prisma.maintenanceTask.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          roomId: dto.roomId,
          title: dto.title,
          description: dto.description,
          category: dto.category,
          priority: dto.priority ?? 'medium',
          status: 'pending',
          assignedToId: dto.assignedToId,
          scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
          estimatedDuration: dto.estimatedDuration,
          estimatedCost: dto.estimatedCost ? parseFloat(dto.estimatedCost) : undefined,
          notes: dto.notes,
        },
        include: {
          property: true,
          room: true,
          assignedTo: true,
        },
      });

      // If room is assigned, mark it as maintenance
      if (dto.roomId) {
        await this.prisma.room.update({
          where: { id: dto.roomId },
          data: { status: 'maintenance' },
        });
      }

      this.logger.log(`Created maintenance task ${task.id} (${task.title})`);
      return task;
    } catch (error) {
      this.logger.error(`Failed to create maintenance task: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a maintenance task
   */
  async update(id: string, dto: UpdateMaintenanceTaskDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const existing = await this.findOne(id, tenantId);

    if (!existing) {
      throw new NotFoundException(`Maintenance task with ID ${id} not found`);
    }

    try {
      const updateData: any = {
        ...(dto.title && { title: dto.title }),
        ...(dto.description && { description: dto.description }),
        ...(dto.category && { category: dto.category }),
        ...(dto.priority && { priority: dto.priority }),
        ...(dto.status && { status: dto.status }),
        ...(dto.assignedToId && { assignedToId: dto.assignedToId }),
        ...(dto.scheduledDate && { scheduledDate: new Date(dto.scheduledDate) }),
        ...(dto.estimatedDuration && { estimatedDuration: dto.estimatedDuration }),
        ...(dto.estimatedCost && { estimatedCost: parseFloat(dto.estimatedCost) }),
        ...(dto.actualCost && { actualCost: parseFloat(dto.actualCost) }),
        ...(dto.notes && { notes: dto.notes }),
        ...(dto.partsUsed && { partsUsed: dto.partsUsed }),
        ...(dto.startedAt && { startedAt: new Date(dto.startedAt) }),
        ...(dto.completedAt && { completedAt: new Date(dto.completedAt) }),
        ...(dto.actualDuration && { actualDuration: dto.actualDuration }),
        ...(dto.rating && { rating: dto.rating }),
        ...(dto.inspectionNotes && { inspectionNotes: dto.inspectionNotes }),
        ...(dto.inspectedById && { inspectedById: dto.inspectedById }),
      };

      const task = await this.prisma.maintenanceTask.update({
        where: { id },
        data: updateData,
        include: {
          property: true,
          room: true,
          assignedTo: true,
          inspectedBy: true,
        },
      });

      // If task is completed, mark room as available again
      if (dto.status === MaintenanceTaskStatus.COMPLETED && task.roomId) {
        await this.prisma.room.update({
          where: { id: task.roomId },
          data: { status: 'available' },
        });
      }

      this.logger.log(`Updated maintenance task ${id}`);
      return task;
    } catch (error) {
      this.logger.error(`Failed to update maintenance task ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a maintenance task
   */
  async remove(id: string, tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.findOne(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Maintenance task with ID ${id} not found`);
    }

    // Check if task is in progress
    if (task.status === 'in_progress') {
      throw new BadRequestException('Cannot delete a task that is currently in progress');
    }

    try {
      await this.prisma.maintenanceTask.delete({ where: { id } });

      // If room was in maintenance, mark it as available
      if (task.roomId) {
        await this.prisma.room.update({
          where: { id: task.roomId },
          data: { status: 'available' },
        });
      }

      this.logger.log(`Deleted maintenance task ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete maintenance task ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get maintenance dashboard metrics
   */
  async getDashboard(propertyId: string, tenantId: string): Promise<DashboardData> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      const where = { tenantId, ...(propertyId && { propertyId }) };

      const [pending, inProgress, completed, allTasks] = await Promise.all([
        this.prisma.maintenanceTask.count({
          where: { ...where, status: 'pending' },
        }),
        this.prisma.maintenanceTask.count({
          where: { ...where, status: 'in_progress' },
        }),
        this.prisma.maintenanceTask.count({
          where: { ...where, status: 'completed' },
        }),
        this.prisma.maintenanceTask.findMany({
          where,
          select: {
            category: true,
            estimatedCost: true,
            actualCost: true,
          },
        }),
      ]);

      // Calculate totals and group by category
      const categoryMap = new Map<string, { count: number; cost: number }>();
      let totalEstimatedCost = 0;
      let totalActualCost = 0;

      allTasks.forEach((task) => {
        const existing = categoryMap.get(task.category) ?? { count: 0, cost: 0 };
        const cost = Number(task.actualCost ?? task.estimatedCost ?? 0);

        categoryMap.set(task.category, {
          count: existing.count + 1,
          cost: existing.cost + cost,
        });

        totalEstimatedCost += Number(task.estimatedCost ?? 0);
        totalActualCost += Number(task.actualCost ?? 0);
      });

      const byCategory = Array.from(categoryMap.entries())
        .map(([category, data]) => ({
          category,
          count: data.count,
          cost: data.cost,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        pendingCount: pending,
        inProgressCount: inProgress,
        completedCount: completed,
        totalEstimatedCost,
        totalActualCost,
        byCategory,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch maintenance dashboard: ${error.message}`);
      throw error;
    }
  }
}
