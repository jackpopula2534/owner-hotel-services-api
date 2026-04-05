import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStaffDto, StaffStatus } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

interface PaginationQuery {
  page?: number;
  limit?: number;
  status?: string;
  department?: string;
  role?: string;
}

interface StaffWithMetrics {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  department?: string;
  employeeCode?: string;
  status: string;
  shiftType?: string;
  maxTasksPerShift?: number;
  specializations?: string;
  rating?: number;
  efficiency?: number;
  createdAt: Date;
  updatedAt: Date;
  tasksToday?: number;
  completedToday?: number;
}

interface PerformanceData {
  tasksCompleted: number;
  averageCompletionTime: number;
  rating: number;
  efficiency: number;
  completedByDate: Array<{
    date: string;
    count: number;
  }>;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all staff with pagination and optional filtering
   */
  async findAll(
    query: PaginationQuery,
    tenantId: string,
  ): Promise<{ data: StaffWithMetrics[]; total: number; page: number; limit: number }> {
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

    if (query.department) {
      where.department = query.department;
    }

    if (query.role) {
      where.role = query.role;
    }

    try {
      const [staff, total] = await Promise.all([
        this.prisma.staff.findMany({
          where,
          skip,
          take: limit,
          include: {
            housekeepingTasks: {
              where: {
                scheduledFor: {
                  gte: new Date(new Date().toDateString()),
                  lt: new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.staff.count({ where }),
      ]);

      const enrichedStaff = staff.map((s) => ({
        ...s,
        rating: s.rating !== null ? Number(s.rating) : undefined,
        efficiency: s.efficiency ?? undefined,
        tasksToday: s.housekeepingTasks.length,
        completedToday: s.housekeepingTasks.filter((t) => t.status === 'completed').length,
      }));

      return { data: enrichedStaff, total, page, limit };
    } catch (error) {
      this.logger.error(`Failed to fetch staff: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get a single staff member by ID
   */
  async findOne(id: string, tenantId: string): Promise<StaffWithMetrics> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    try {
      const staff = await this.prisma.staff.findFirst({
        where: { id, tenantId },
        include: {
          housekeepingTasks: {
            where: {
              scheduledFor: {
                gte: new Date(new Date().toDateString()),
                lt: new Date(new Date().getTime() + 24 * 60 * 60 * 1000),
              },
            },
          },
        },
      });

      if (!staff) {
        throw new NotFoundException(`Staff member with ID ${id} not found`);
      }

      return {
        ...staff,
        rating: staff.rating !== null ? Number(staff.rating) : undefined,
        efficiency: staff.efficiency ?? undefined,
        tasksToday: staff.housekeepingTasks.length,
        completedToday: staff.housekeepingTasks.filter((t) => t.status === 'completed').length,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch staff ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create a new staff member
   */
  async create(dto: CreateStaffDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check for email uniqueness within tenant
    const existingStaff = await this.prisma.staff.findFirst({
      where: {
        email: dto.email,
        tenantId,
      },
    });

    if (existingStaff) {
      throw new ConflictException(`Staff member with email ${dto.email} already exists in this tenant`);
    }

    try {
      const staff = await this.prisma.staff.create({
        data: {
          tenantId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          role: dto.role,
          department: dto.department,
          employeeCode: dto.employeeCode,
          status: dto.status ?? StaffStatus.ACTIVE,
          shiftType: dto.shiftType,
          maxTasksPerShift: dto.maxTasksPerShift ?? 8,
          specializations: dto.specializations ? JSON.stringify(dto.specializations) : null,
          efficiency: 100,
        },
      });

      this.logger.log(`Created staff member ${staff.id} (${staff.firstName} ${staff.lastName})`);
      return staff;
    } catch (error) {
      this.logger.error(`Failed to create staff member: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update a staff member
   */
  async update(id: string, dto: UpdateStaffDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify staff exists
    const existing = await this.findOne(id, tenantId);

    if (!existing) {
      throw new NotFoundException(`Staff member with ID ${id} not found`);
    }

    // Check email uniqueness if being updated
    if (dto.email && dto.email !== existing.email) {
      const emailTaken = await this.prisma.staff.findFirst({
        where: {
          email: dto.email,
          tenantId,
          NOT: { id },
        },
      });

      if (emailTaken) {
        throw new ConflictException(`Email ${dto.email} is already in use`);
      }
    }

    try {
      const updated = await this.prisma.staff.update({
        where: { id },
        data: {
          ...(dto.firstName && { firstName: dto.firstName }),
          ...(dto.lastName && { lastName: dto.lastName }),
          ...(dto.email && { email: dto.email }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.role && { role: dto.role }),
          ...(dto.department && { department: dto.department }),
          ...(dto.employeeCode && { employeeCode: dto.employeeCode }),
          ...(dto.status && { status: dto.status }),
          ...(dto.shiftType && { shiftType: dto.shiftType }),
          ...(dto.maxTasksPerShift !== undefined && { maxTasksPerShift: dto.maxTasksPerShift }),
          ...(dto.specializations && {
            specializations: JSON.stringify(dto.specializations),
          }),
        },
      });

      this.logger.log(`Updated staff member ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`Failed to update staff member ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a staff member
   * Only allowed if they have no active tasks
   */
  async remove(id: string, tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const staff = await this.findOne(id, tenantId);

    if (!staff) {
      throw new NotFoundException(`Staff member with ID ${id} not found`);
    }

    // Check for active housekeeping tasks
    const activeTasks = await this.prisma.housekeepingTask.count({
      where: {
        assignedToId: id,
        status: { in: ['pending', 'in_progress'] },
      },
    });

    if (activeTasks > 0) {
      throw new BadRequestException(
        `Cannot delete staff member with ${activeTasks} active task(s). Please reassign or complete them first.`,
      );
    }

    try {
      await this.prisma.staff.delete({ where: { id } });
      this.logger.log(`Deleted staff member ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete staff member ${id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get staff performance metrics
   */
  async getPerformance(
    id: string,
    tenantId: string,
    period: 'week' | 'month' | 'year' = 'month',
  ): Promise<PerformanceData> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const staff = await this.findOne(id, tenantId);

    if (!staff) {
      throw new NotFoundException(`Staff member with ID ${id} not found`);
    }

    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    try {
      const completedTasks = await this.prisma.housekeepingTask.findMany({
        where: {
          assignedToId: id,
          status: 'completed',
          actualEndTime: {
            gte: startDate,
            lte: now,
          },
        },
      });

      const tasksCount = completedTasks.length;
      const totalDuration = completedTasks.reduce((sum, t) => sum + (t.actualDuration ?? 0), 0);
      const avgCompletionTime = tasksCount > 0 ? Math.round(totalDuration / tasksCount) : 0;
      const avgRating = tasksCount > 0
        ? Number((completedTasks.reduce((sum, t) => sum + (t.rating ?? 0), 0) / tasksCount).toFixed(2))
        : 0;

      // Group by date
      const completedByDate = new Map<string, number>();
      completedTasks.forEach((task) => {
        const dateStr = task.actualEndTime ? new Date(task.actualEndTime).toISOString().split('T')[0] : '';
        if (dateStr) {
          completedByDate.set(dateStr, (completedByDate.get(dateStr) ?? 0) + 1);
        }
      });

      const completedByDateArray = Array.from(completedByDate.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        tasksCompleted: tasksCount,
        averageCompletionTime: avgCompletionTime,
        rating: avgRating,
        efficiency: staff.efficiency ?? 100,
        completedByDate: completedByDateArray,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch performance for staff ${id}: ${error.message}`);
      throw error;
    }
  }
}
