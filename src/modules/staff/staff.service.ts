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
import { normalizePagination } from '../../common/utils/pagination.util';
import { LinkEmployeeDto } from './dto/link-employee.dto';
import { AuditLogService } from '../../audit-log/audit-log.service';

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

  constructor(private prisma: PrismaService, private auditLogService: AuditLogService) {}

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

    const { page, limit, skip } = normalizePagination(query.page, query.limit);

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
      this.logger.error(`Failed to fetch staff (with task metrics): ${(error as any)?.message ?? error}`);

      // Any error (missing table, missing column, FK mismatch, etc.) — fall back progressively
      this.logger.warn('Falling back to basic staff query without task metrics (run migration to fix)');
      try {
        const [staff, total] = await Promise.all([
          this.prisma.staff.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.staff.count({ where }),
        ]);

        const enrichedStaff = staff.map((s) => ({
          ...s,
          rating: s.rating !== null ? Number(s.rating) : undefined,
          efficiency: s.efficiency ?? undefined,
          tasksToday: 0,
          completedToday: 0,
        }));

        return { data: enrichedStaff, total, page, limit };
      } catch (fallbackError) {
        this.logger.error(`Fallback staff query also failed: ${(fallbackError as any)?.message ?? fallbackError}`);
        return { data: [], total: 0, page, limit };
      }
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
      let staff: any;

      // Try with housekeeping task metrics, fall back to plain lookup if schema not ready
      try {
        staff = await this.prisma.staff.findFirst({
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
      } catch {
        staff = await this.prisma.staff.findFirst({
          where: { id, tenantId },
        });
      }

      if (!staff) {
        throw new NotFoundException(`Staff member with ID ${id} not found`);
      }

      return {
        ...staff,
        rating: staff.rating !== null ? Number(staff.rating) : undefined,
        efficiency: staff.efficiency ?? undefined,
        tasksToday: staff.housekeepingTasks?.length ?? 0,
        completedToday: staff.housekeepingTasks?.filter((t: any) => t.status === 'completed').length ?? 0,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch staff ${id}: ${(error as any)?.message ?? error}`);
      throw error;
    }
  }

  /**
   * Create a new staff member
   */
  async create(dto: CreateStaffDto, tenantId: string, userId?: string): Promise<any> {
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

      this.auditLogService.logStaffCreate(staff, userId, tenantId);
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
  async update(id: string, dto: UpdateStaffDto, tenantId: string, userId?: string): Promise<any> {
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

      this.auditLogService.logStaffUpdate(id, existing, updated, userId, tenantId);
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

  // ─── HR Add-on bridge endpoints ───────────────────────────────────────────

  /**
   * Link an Employee record to this Staff member (requires HR_MODULE add-on).
   * Both records must belong to the same tenant.
   */
  async linkEmployee(staffId: string, dto: LinkEmployeeDto, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const staff = await this.findOne(staffId, tenantId);

    if ((staff as any).employeeId) {
      throw new ConflictException(
        `Staff ${staffId} is already linked to employee ${(staff as any).employeeId}. Unlink first.`,
      );
    }

    // Verify the Employee belongs to same tenant
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employee ${dto.employeeId} not found in this tenant`,
      );
    }

    // Guard: Employee not already linked to another Staff (cast to any — field added in latest migration)
    const alreadyLinked = await (this.prisma.staff as any).findUnique({
      where: { employeeId: dto.employeeId },
    });
    if (alreadyLinked) {
      throw new ConflictException(
        `Employee ${dto.employeeId} is already linked to staff ${alreadyLinked.id}`,
      );
    }

    const updated = await (this.prisma.staff as any).update({
      where: { id: staffId },
      data: { employeeId: dto.employeeId },  // field added in latest migration
      include: { employee: true },
    });

    this.logger.log(`Linked Staff ${staffId} ↔ Employee ${dto.employeeId} (tenant: ${tenantId})`);
    return { success: true, data: updated };
  }

  /**
   * Remove the HR link from a Staff record (requires HR_MODULE add-on).
   * Staff record is preserved; employeeId is set to null.
   */
  async unlinkEmployee(staffId: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const staff = await this.findOne(staffId, tenantId) as any;

    if (!staff.employeeId) {
      throw new BadRequestException(`Staff ${staffId} is not linked to any employee`);
    }

    const updated = await (this.prisma.staff as any).update({
      where: { id: staffId },
      data: { employeeId: null },  // field added in latest migration
    });

    this.logger.log(`Unlinked Staff ${staffId} from Employee (tenant: ${tenantId})`);
    return { success: true, data: updated };
  }

  /**
   * Get the linked Employee record for a Staff member (requires HR_MODULE add-on).
   */
  async getLinkedEmployee(staffId: string, tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const staff = await (this.prisma.staff as any).findFirst({
      where: { id: staffId, tenantId },
      include: { employee: true },  // relation added in latest migration
    });

    if (!staff) {
      throw new NotFoundException(`Staff member with ID ${staffId} not found`);
    }

    if (!(staff as any).employeeId || !(staff as any).employee) {
      return { success: true, data: null, linked: false };
    }

    return { success: true, data: (staff as any).employee, linked: true };
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
