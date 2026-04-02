import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHousekeepingTaskDto, TaskType, TaskPriority, TaskStatus } from './dto/create-housekeeping-task.dto';

@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  constructor(private prisma: PrismaService) {}

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
        },
      });

      this.logger.log(
        `Created housekeeping task ${task.id} for room ${room.number} (${dto.type})`
      );

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
}
