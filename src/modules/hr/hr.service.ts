import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    private prisma: PrismaService,
    private employeeCodeConfigService: EmployeeCodeConfigService,
  ) {}

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { department, position, departmentId, positionId, search, propertyId, hotelId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = { tenantId };
    const finalPropertyId = propertyId || hotelId;
    if (finalPropertyId) (where as any).propertyId = finalPropertyId;
    if (department) (where as any).department = department;
    if (position) (where as any).position = position;
    if (departmentId) (where as any).departmentId = departmentId;
    if (positionId) (where as any).positionId = positionId;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { employeeCode: { contains: search } },
      ];
    }
    // Filter to only employees NOT yet linked to a Staff record
    if (query.unlinkedOnly === 'true') {
      (where as any).staff = { is: null };
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma.employee as any).findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            staff: { select: { id: true, role: true, status: true } },
            hrDepartment: true,
            hrPosition: true,
          },
        }),
        this.prisma.employee.count({ where }),
      ]);

      return { data, total, page, limit };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return { data: [], total: 0, page, limit };
        }
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const employee = await (this.prisma.employee as any).findFirst({
      where: { id, tenantId },
      include: {
        staff: { select: { id: true, role: true, status: true, department: true } },
        hrDepartment: true,
        hrPosition: true,
      },
    });

    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    return employee;
  }

  async create(createEmployeeDto: CreateEmployeeDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { hotelId, propertyId, startDate, dateOfBirth, ...rest } = createEmployeeDto;
    const finalPropertyId = propertyId || hotelId;

    // Auto-generate employee code if not provided — pass propertyId so the generator
    // skips codes already used in this specific hotel (unique per tenantId+propertyId)
    let employeeCode = createEmployeeDto.employeeCode;
    if (!employeeCode) {
      try {
        let departmentCode = '';
        if (createEmployeeDto.departmentId) {
          const dept = await (this.prisma as any).hrDepartment.findUnique({
            where: { id: createEmployeeDto.departmentId },
            select: { code: true, name: true },
          });
          departmentCode = dept?.code ?? dept?.name?.substring(0, 3)?.toUpperCase() ?? '';
        }

        employeeCode = await this.employeeCodeConfigService.generateNextCode(
          tenantId,
          departmentCode,
          finalPropertyId, // scope collision check to this hotel
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Auto-generate employee code failed, proceeding without: ${msg}`);
      }
    } else {
      // Caller supplied a code manually — verify it is not already taken in this hotel
      const codeConflict = await (this.prisma.employee as any).findFirst({
        where: {
          tenantId,
          employeeCode,
          ...(finalPropertyId ? { propertyId: finalPropertyId } : {}),
        },
        select: { id: true },
      });
      if (codeConflict) {
        throw new ConflictException(
          `รหัสพนักงาน "${employeeCode}" มีอยู่ในระบบของโรงแรมนี้แล้ว กรุณาใช้รหัสอื่น`,
        );
      }
    }

    return (this.prisma.employee as any).create({
      data: {
        ...rest,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        propertyId: finalPropertyId,
        tenantId,
        ...(employeeCode ? { employeeCode } : {}),
      },
      include: { hrDepartment: true, hrPosition: true },
    });
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto, tenantId?: string) {
    const employee = await this.findOne(id, tenantId);

    const { hotelId, propertyId, startDate, dateOfBirth, ...rest } = updateEmployeeDto;
    const finalPropertyId = propertyId || hotelId || (employee as any).propertyId;

    // ── Conflict check when employeeCode is being changed ──────────────
    if (rest.employeeCode && rest.employeeCode !== (employee as any).employeeCode) {
      const codeConflict = await (this.prisma.employee as any).findFirst({
        where: {
          tenantId,
          employeeCode: rest.employeeCode,
          ...(finalPropertyId ? { propertyId: finalPropertyId } : {}),
          id: { not: id },
        },
        select: { id: true },
      });
      if (codeConflict) {
        throw new ConflictException(
          `รหัสพนักงาน "${rest.employeeCode}" มีอยู่ในระบบของโรงแรมนี้แล้ว กรุณาใช้รหัสอื่น`,
        );
      }
    }

    const updated = (await (this.prisma.employee as any).update({
      where: { id },
      data: {
        ...rest,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        ...(finalPropertyId ? { propertyId: finalPropertyId } : {}),
      },
      include: {
        staff: { select: { id: true, role: true, status: true } },
        hrDepartment: true,
        hrPosition: true,
      },
    })) as any;

    // Auto-sync basic info to linked Staff record if one exists
    if (updated.staff) {
      await this.syncEmployeeToStaff(updated.staff.id, updated).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-sync to Staff ${updated.staff.id} failed: ${msg}`);
      });
    }

    return updated;
  }

  /**
   * Dashboard stats: total employees, today's attendance, on-leave, pending leave requests.
   * All counts are scoped to tenantId and optionally filtered by propertyId (hotelId).
   * Uses Promise.all for parallel queries — optimized for dashboard rendering.
   */
  async getDashboardStats(tenantId?: string, hotelId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const employeeWhere: { tenantId: string; propertyId?: string } = { tenantId };
    if (hotelId) employeeWhere.propertyId = hotelId;

    const [totalEmployees, todayAttendance, onLeave, pendingLeaveRequests] = await Promise.all([
      // Total active employees
      this.prisma.employee.count({ where: employeeWhere }),

      // Today's check-ins (present or late)
      (this.prisma.hrAttendance as any).count({
        where: {
          tenantId,
          date: { gte: todayStart, lt: todayEnd },
          status: { in: ['present', 'late'] },
        },
      }),

      // Currently on approved leave (today is within leave date range)
      (this.prisma.hrLeaveRequest as any).count({
        where: {
          tenantId,
          status: 'approved',
          startDate: { lte: todayStart },
          endDate: { gte: todayStart },
        },
      }),

      // Pending leave requests (awaiting approval)
      (this.prisma.hrLeaveRequest as any).count({
        where: { tenantId, status: 'pending' },
      }),
    ]);

    const attendanceRate =
      totalEmployees > 0 ? Math.round((todayAttendance / totalEmployees) * 100) : 0;

    return {
      totalEmployees,
      todayAttendance,
      onLeave,
      pendingLeaveRequests,
      attendanceRate,
    };
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    // onDelete: SetNull — Staff.employeeId is cleared automatically by DB FK
    return this.prisma.employee.delete({ where: { id } });
  }

  /**
   * Create a Staff record linked to an existing Employee (HR Add-on bridge).
   * The Staff inherits first/last name, email, department and employeeCode.
   * The role defaults to 'housekeeper' — pass `dto.role` to override (e.g. 'technician' for ช่าง).
   *
   * Wrapped in a Prisma transaction so the existence-check + create are atomic.
   * If any step fails the transaction is automatically rolled back — no orphaned
   * Staff record is left behind.
   */
  async createStaffFromEmployee(
    employeeId: string,
    tenantId?: string,
    dto?: { role?: string; department?: string },
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const employee = await this.findOne(employeeId, tenantId);

    // Resolve role and department: caller-supplied > inferred from employee dept code > defaults
    const resolvedRole = dto?.role ?? 'housekeeper';
    const resolvedDepartment =
      dto?.department ?? (resolvedRole === 'technician' ? 'maintenance' : 'housekeeping');

    try {
      // Atomic: guard check + Staff creation in a single transaction.
      // If the DB fails mid-way, Prisma rolls back automatically.
      const staff = await this.prisma.$transaction(async (tx) => {
        // Re-check inside transaction to prevent race conditions
        const existingStaff = await (tx.staff as any).findUnique({
          where: { employeeId },
        });
        if (existingStaff) {
          throw new ConflictException(
            `Employee ${employeeId} already has a linked Staff record (${existingStaff.id})`,
          );
        }

        return (tx.staff as any).create({
          data: {
            tenantId,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            employeeCode: (employee as any).employeeCode ?? undefined,
            department: resolvedDepartment,
            role: resolvedRole,
            status: 'active',
            employeeId: employee.id,
          },
        });
      });

      this.logger.log(
        `Staff ${staff.id} (${resolvedRole}) created and linked to Employee ${employee.id} (tenant: ${tenantId})`,
      );

      return {
        success: true,
        data: staff,
        linkedEmployee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
        },
      };
    } catch (error: unknown) {
      // Re-throw NestJS HTTP exceptions (ConflictException, NotFoundException, etc.) directly
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Transaction rolled back — failed to create Staff from Employee ${employeeId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Bulk create Staff records for all HR employees that are not yet linked.
   * Safe to run multiple times — already-linked employees are skipped.
   *
   * Each employee's creation is wrapped in its own Prisma transaction so a failure
   * for one employee does not affect others (partial-success is intentional here).
   * The per-item transaction also prevents races: the linked-check and create are
   * atomic for each employee.
   */
  async bulkCreateStaffFromEmployees(tenantId: string): Promise<{
    created: number;
    skipped: number;
    results: Array<{
      employeeId: string;
      employeeName: string;
      staffId?: string;
      status: 'created' | 'skipped';
      reason?: string;
    }>;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Fetch all employees for this tenant (server-side check, not client-side)
    const employees = await this.prisma.employee.findMany({
      where: { tenantId },
    });

    const results: Array<{
      employeeId: string;
      employeeName: string;
      staffId?: string;
      status: 'created' | 'skipped';
      reason?: string;
    }> = [];
    let created = 0;
    let skipped = 0;

    for (const employee of employees) {
      const employeeName = `${employee.firstName} ${employee.lastName}`;

      try {
        // Each employee gets its own transaction:
        // - If the employee is already linked → ConflictException is caught below → skipped
        // - If create fails mid-way → transaction rolls back automatically → no orphan record
        const staff = await this.prisma.$transaction(async (tx) => {
          // Atomic guard: check + create (prevents duplicate on concurrent calls)
          const existingStaff = await (tx.staff as any).findUnique({
            where: { employeeId: employee.id },
          });
          if (existingStaff) {
            throw new ConflictException(`Already linked to Staff record ${existingStaff.id}`);
          }

          return (tx.staff as any).create({
            data: {
              tenantId,
              firstName: employee.firstName,
              lastName: employee.lastName,
              email: employee.email,
              employeeCode: (employee as any).employeeCode ?? undefined,
              department: 'housekeeping',
              role: 'housekeeper',
              status: 'active',
              employeeId: employee.id,
            },
          });
        });

        results.push({
          employeeId: employee.id,
          employeeName,
          staffId: staff.id,
          status: 'created',
        });
        created++;
        this.logger.log(
          `Bulk sync: Staff ${staff.id} created and linked to Employee ${employee.id}`,
        );
      } catch (error: unknown) {
        const reason =
          error instanceof ConflictException
            ? 'Already linked to a Staff record'
            : error instanceof Error
              ? error.message
              : 'Unknown error';

        results.push({ employeeId: employee.id, employeeName, status: 'skipped', reason });
        skipped++;

        if (!(error instanceof ConflictException)) {
          // Unexpected error (not a duplicate) — transaction already rolled back
          this.logger.warn(
            `Bulk sync: transaction rolled back for Employee ${employee.id} — ${reason}`,
          );
        }
      }
    }

    this.logger.log(
      `Bulk Staff sync complete for tenant ${tenantId}: ${created} created, ${skipped} skipped`,
    );

    return { created, skipped, results };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Sync Employee name/email changes down to the linked Staff record. */
  private async syncEmployeeToStaff(
    staffId: string,
    employee: { firstName: string; lastName: string; email: string },
  ): Promise<void> {
    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
      },
    });
    this.logger.log(`Synced Employee changes to Staff ${staffId}`);
  }
}
