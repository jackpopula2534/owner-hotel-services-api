import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHousekeepingTaskDto,
  TaskType,
  TaskPriority,
  TaskStatus,
} from './dto/create-housekeeping-task.dto';
import { UpdateHousekeepingTaskDto } from './dto/update-housekeeping-task.dto';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { normalizePagination } from '../../common/utils/pagination.util';
import {
  INVENTORY_EVENTS,
  HousekeepingTaskCompletedEvent,
} from '../inventory/events/inventory.events';

interface TaskQuery {
  status?: string;
  roomId?: string;
  assignedToId?: string;
  propertyId?: string;
  type?: string;
  page?: number;
  limit?: number;
}

interface DashboardData {
  pendingCount: number;
  inProgressCount: number;
  completedToday: number;
  avgCompletionTime: number;
}

interface RoomStatusData {
  status: string;
  roomReadyAt?: Date;
  currentTask?: any;
}

@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a housekeeping task
   */
  async createTask(dto: CreateHousekeepingTaskDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify room exists and belongs to tenant
    const room = await this.prisma.room.findFirst({
      where: { id: dto.roomId, tenantId },
      include: { property: true },
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${dto.roomId} not found`);
    }

    try {
      const task = await this.prisma.housekeepingTask.create({
        data: {
          roomId: dto.roomId,
          type: dto.type,
          priority: dto.priority,
          status: dto.status || TaskStatus.PENDING,
          notes: dto.notes,
          estimatedDuration: dto.estimatedDuration || 30,
          tenantId,
          ...(dto.bookingId && { bookingId: dto.bookingId }),
          ...(dto.scheduledFor && { scheduledFor: new Date(dto.scheduledFor) }),
          ...(dto.roomReadyAt && { roomReadyAt: new Date(dto.roomReadyAt) }),
        },
      });

      this.logger.log(`Created housekeeping task ${task.id} for room ${room.number} (${dto.type})`);

      return task;
    } catch (error) {
      this.logger.error(`Failed to create housekeeping task: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status: string, tenantId: string): Promise<any[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.prisma.housekeepingTask.findMany({
      where: { status, tenantId },
      include: { room: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update task status
   */
  async updateTaskStatus(id: string, status: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify task exists and belongs to tenant
    const task = await this.prisma.housekeepingTask.findFirst({
      where: { id, tenantId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const updated = await this.prisma.housekeepingTask.update({
      where: { id },
      data: { status },
      include: { room: true },
    });

    this.logger.log(`Updated task ${id} status to ${status}`);

    return updated;
  }

  /**
   * Get task by ID
   */
  async getTask(id: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.prisma.housekeepingTask.findFirst({
      where: { id, tenantId },
      include: { room: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  /**
   * Get all tasks for a room
   */
  async getTasksByRoom(roomId: string, tenantId: string): Promise<any[]> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    return this.prisma.housekeepingTask.findMany({
      where: { roomId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get tasks with filtering and pagination
   */
  async getTasks(
    query: TaskQuery,
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

    const { page, limit, skip } = normalizePagination(query.page, query.limit);

    const where: any = { tenantId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.roomId) {
      where.roomId = query.roomId;
    }

    if (query.assignedToId) {
      where.assignedToId = query.assignedToId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.propertyId) {
      where.room = { propertyId: query.propertyId };
    }

    try {
      const [tasks, total] = await Promise.all([
        this.prisma.housekeepingTask.findMany({
          where,
          skip,
          take: limit,
          include: { room: true, assignedTo: true, inspectedBy: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.housekeepingTask.count({ where }),
      ]);

      return { data: tasks, total, page, limit };
    } catch (error) {
      this.logger.error(
        `Failed to fetch housekeeping tasks (full include): ${(error as any)?.message ?? error}`,
      );

      // Any DB/schema error (P2021 table not found, P2022 column not found, or any other)
      // falls back progressively — this covers partially-run migrations
      this.logger.warn(
        'Falling back to basic query without Staff relations (run migration to fix)',
      );
      try {
        const [tasks, total] = await Promise.all([
          this.prisma.housekeepingTask.findMany({
            where,
            skip,
            take: limit,
            include: { room: true },
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.housekeepingTask.count({ where }),
        ]);
        return { data: tasks, total, page, limit };
      } catch (fallbackError) {
        this.logger.error(
          `Fallback query also failed: ${(fallbackError as any)?.message ?? fallbackError}`,
        );
        return { data: [], total: 0, page, limit };
      }
    }
  }

  /**
   * Update task details
   */
  async updateTask(id: string, dto: UpdateHousekeepingTaskDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    try {
      const updateData: any = {
        ...(dto.status && { status: dto.status }),
        ...(dto.assignedToId && { assignedToId: dto.assignedToId }),
        ...(dto.assignedToName && { assignedToName: dto.assignedToName }),
        ...(dto.notes && { notes: dto.notes }),
        ...(dto.completionPercentage !== undefined && {
          completionPercentage: dto.completionPercentage,
        }),
        ...(dto.rating && { rating: dto.rating }),
        ...(dto.inspectionNotes && { inspectionNotes: dto.inspectionNotes }),
        ...(dto.inspectedById && { inspectedById: dto.inspectedById }),
        ...(dto.inspectedByName && { inspectedByName: dto.inspectedByName }),
        ...(dto.scheduledFor && { scheduledFor: new Date(dto.scheduledFor) }),
        ...(dto.actualStartTime && { actualStartTime: new Date(dto.actualStartTime) }),
        ...(dto.actualEndTime && { actualEndTime: new Date(dto.actualEndTime) }),
        ...(dto.roomReadyAt && { roomReadyAt: new Date(dto.roomReadyAt) }),
      };

      let updated: any;
      try {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: updateData,
          include: { room: true, assignedTo: true, inspectedBy: true },
        });
      } catch {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: updateData,
          include: { room: true },
        });
      }

      this.logger.log(`Updated task ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to update task ${id}: ${(error as any)?.message ?? error}`);
      throw error;
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string, tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (task.status === 'in_progress') {
      throw new BadRequestException('Cannot delete a task that is currently in progress');
    }

    try {
      await this.prisma.housekeepingTask.delete({ where: { id } });
      this.logger.log(`Deleted task ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete task ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Assign task to staff
   */
  async assignTask(
    id: string,
    assignedToId: string,
    assignedToName: string,
    tenantId: string,
  ): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    try {
      let updated: any;
      try {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: { assignedToId, assignedToName },
          include: { room: true, assignedTo: true },
        });
      } catch {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: { assignedToId, assignedToName },
          include: { room: true },
        });
      }

      this.logger.log(`Assigned task ${id} to staff ${assignedToId}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to assign task ${id}: ${(error as any)?.message ?? error}`);
      throw error;
    }
  }

  /**
   * Start task (set status and actualStartTime)
   */
  async startTask(id: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    try {
      let updated: any;
      try {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: {
            status: 'in_progress',
            actualStartTime: new Date(),
          },
          include: { room: true, assignedTo: true },
        });
      } catch {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: { status: 'in_progress' },
          include: { room: true },
        });
      }

      this.logger.log(`Started task ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to start task ${id}: ${(error as any)?.message ?? error}`);
      throw error;
    }
  }

  /**
   * Complete task (set status, actualEndTime, and actualDuration)
   */
  async completeTask(
    id: string,
    completionPercentage: number,
    notes: string,
    tenantId: string,
    completedByUserId?: string,
  ): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const now = new Date();
    let actualDuration: number | null = null;

    if (task.actualStartTime) {
      actualDuration = Math.round(
        (now.getTime() - new Date(task.actualStartTime).getTime()) / 60000,
      );
    }

    try {
      // Build update data — only include new fields if migration has been run
      const updateData: any = { status: 'completed', ...(notes && { notes }) };
      try {
        updateData.actualEndTime = now;
        updateData.actualDuration = actualDuration;
        updateData.completionPercentage = completionPercentage;
        updateData.roomReadyAt = now;
      } catch {
        /* ignore — column may not exist yet */
      }

      let updated: any;
      try {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: updateData,
          include: { room: true, assignedTo: true },
        });
      } catch {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: { status: 'completed', ...(notes && { notes }) },
          include: { room: true },
        });
      }

      // Update room status to available
      if (task.roomId) {
        await this.prisma.room.update({
          where: { id: task.roomId },
          data: { status: 'available' },
        });
      }

      await this.auditLogService.logHousekeepingTaskCompletion(
        {
          ...updated,
          previousStatus: task.status,
          previousRoomStatus: task.room?.status,
        },
        completedByUserId,
        tenantId,
      );

      // Emit event for inventory integration (auto-deduct amenities)
      try {
        const room = updated.room || task.room;
        if (room) {
          const event: HousekeepingTaskCompletedEvent = {
            taskId: id,
            tenantId,
            roomId: task.roomId,
            roomType: room.type || 'standard',
            taskType: task.type || 'checkout',
            propertyId: room.propertyId,
            completedBy: completedByUserId || 'system',
          };
          this.eventEmitter.emit(INVENTORY_EVENTS.HOUSEKEEPING_TASK_COMPLETED, event);
        }
      } catch (eventError) {
        // Don't fail task completion if event emission fails
        this.logger.warn(
          `Failed to emit housekeeping completion event: ${(eventError as Error).message}`,
        );
      }

      this.logger.log(`Completed task ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to complete task ${id}: ${(error as any)?.message ?? error}`);
      throw error;
    }
  }

  /**
   * Inspect task (set status to inspected)
   */
  async inspectTask(
    id: string,
    rating: number,
    inspectionNotes: string,
    inspectedById: string,
    inspectedByName: string,
    tenantId: string,
  ): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const task = await this.getTask(id, tenantId);

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    try {
      let updated: any;
      try {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: {
            status: 'inspected',
            rating,
            inspectionNotes,
            inspectedById,
            inspectedByName,
          },
          include: { room: true, assignedTo: true, inspectedBy: true },
        });
      } catch {
        updated = await this.prisma.housekeepingTask.update({
          where: { id },
          data: { status: 'inspected', rating, inspectionNotes },
          include: { room: true },
        });
      }

      this.logger.log(`Inspected task ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to inspect task ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get dashboard metrics
   */
  async getDashboard(propertyId: string, tenantId: string): Promise<DashboardData> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    try {
      const where: any = { tenantId };

      if (propertyId) {
        where.room = { propertyId };
      }

      const [pending, inProgress, completedToday, allCompleted] = await Promise.all([
        this.prisma.housekeepingTask.count({
          where: { ...where, status: 'pending' },
        }),
        this.prisma.housekeepingTask.count({
          where: { ...where, status: 'in_progress' },
        }),
        this.prisma.housekeepingTask.count({
          where: {
            ...where,
            status: 'completed',
            actualEndTime: { gte: today, lt: tomorrow },
          },
        }),
        this.prisma.housekeepingTask.findMany({
          where: {
            ...where,
            status: 'completed',
            actualDuration: { not: null },
          },
          select: { actualDuration: true },
        }),
      ]);

      const avgCompletionTime =
        allCompleted.length > 0
          ? Math.round(
              allCompleted.reduce((sum, t) => sum + (t.actualDuration ?? 0), 0) /
                allCompleted.length,
            )
          : 0;

      return {
        pendingCount: pending,
        inProgressCount: inProgress,
        completedToday,
        avgCompletionTime,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch dashboard: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get room status
   */
  async getRoomStatus(roomId: string, tenantId: string): Promise<RoomStatusData> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      // Try with Staff include first, fall back to plain query if schema not ready
      let room: any;
      let currentTask: any;
      try {
        [room, currentTask] = await Promise.all([
          this.prisma.room.findFirst({
            where: { id: roomId, tenantId },
          }),
          this.prisma.housekeepingTask.findFirst({
            where: {
              roomId,
              tenantId,
              status: { in: ['pending', 'in_progress'] },
            },
            include: { assignedTo: true },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
      } catch {
        [room, currentTask] = await Promise.all([
          this.prisma.room.findFirst({
            where: { id: roomId, tenantId },
          }),
          this.prisma.housekeepingTask.findFirst({
            where: {
              roomId,
              tenantId,
              status: { in: ['pending', 'in_progress'] },
            },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
      }

      if (!room) {
        throw new NotFoundException(`Room with ID ${roomId} not found`);
      }

      return {
        status: room.status,
        roomReadyAt: currentTask?.roomReadyAt,
        currentTask,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch room status: ${error.message}`);
      throw error;
    }
  }
}
