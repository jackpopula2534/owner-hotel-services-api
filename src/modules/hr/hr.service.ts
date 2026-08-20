import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Prisma } from '@prisma/client';
import { StaffService } from '../staff/staff.service';

/**
 * ตำแหน่งบนทะเบียนพนักงานปฏิบัติการ เดาจากรหัสแผนกของ HR
 *
 * ENG (วิศวกรรม) และแผนกที่ชื่อสื่อถึงงานช่าง → ช่างซ่อมบำรุง
 * นอกนั้น (HK ฯลฯ) → แม่บ้าน
 */
function inferStaffRoleFromDepartment(code?: string | null, name?: string | null): 'housekeeper' | 'technician' {
  const c = (code ?? '').toUpperCase();
  if (c === 'ENG' || c === 'MAINT' || c === 'MAINTENANCE') return 'technician';
  const n = (name ?? '').toLowerCase();
  if (n.includes('engineer') || n.includes('maintenance') || n.includes('วิศวกรรม')) {
    return 'technician';
  }
  return 'housekeeper';
}

/** แผนกที่ปกติแล้วมีหน้างานในโรงแรม — ใช้เป็นค่าตั้งต้นของการนำเข้าแบบยกชุด */
const OPERATIONAL_DEPARTMENT_CODES = ['HK', 'ENG'];

/** สถานะพนักงาน HR ที่ถือว่ายังทำงานอยู่ — คนที่ลาออก/พ้นสภาพต้องไม่ถูกนำเข้า */
const EMPLOYABLE_STATUSES = ['ACTIVE', 'PROBATION'];

export interface BulkCreateStaffOptions {
  /** เจาะจงรายคน — ถ้าส่งมา จะไม่สนใจตัวกรองแผนก */
  employeeIds?: string[];
  /** กรองตามแผนก HR (id) — ไม่ส่ง = ใช้แผนกปฏิบัติการตั้งต้น (HK, ENG) */
  departmentIds?: string[];
  /** true = ไม่กรองแผนกเลย นำเข้าทุกคนที่ยังทำงานอยู่ */
  allDepartments?: boolean;
  /** บังคับตำแหน่งเดียวกันทุกคน — ไม่ส่ง = เดาจากแผนกรายคน */
  role?: 'housekeeper' | 'technician';
  /** true = รวมคนที่พ้นสภาพแล้วด้วย (ปกติไม่ควรใช้) */
  includeInactive?: boolean;
}

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    private prisma: PrismaService,
    private employeeCodeConfigService: EmployeeCodeConfigService,
    private hrLifecycleAssignmentService: HrLifecycleAssignmentService,
    private staffService: StaffService,
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

      // แผนกที่มาจากระบบคัดสรร (recruitment) จะตั้งแค่ departmentId (FK) ไม่ได้ตั้ง
      // free-text `department` → frontend ที่อ่าน emp.department จึงเห็นว่าง.
      // normalize ให้ fallback ไปใช้ชื่อจาก relation hrDepartment เมื่อ string ว่าง.
      const normalized = (data as any[]).map((emp) => ({
        ...emp,
        department: emp.department ?? emp.hrDepartment?.name ?? null,
      }));

      return { data: normalized, total, page, limit };
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

    // fallback ชื่อแผนกจาก relation เมื่อ free-text `department` ว่าง (เช่นพนักงานจากระบบคัดสรร)
    return {
      ...employee,
      department: employee.department ?? employee.hrDepartment?.name ?? null,
    };
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
          const dept = await (this.prisma as any).hrDepartment.findFirst({
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

    // Auto-set consentAt when consentGiven = true (PDPA requirement)
    const consentAt = rest.consentGiven === true ? new Date() : undefined;

    const created = await (this.prisma.employee as any).create({
      data: {
        ...rest,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        ...(consentAt ? { consentAt } : {}),
        propertyId: finalPropertyId,
        tenantId,
        ...(employeeCode ? { employeeCode } : {}),
      },
      include: { hrDepartment: true, hrPosition: true },
    });

    await this.hrLifecycleAssignmentService
      .recomputeForEmployee(created.id, tenantId)
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Lifecycle assignment bootstrap failed for employee ${created.id}: ${msg}`);
      });

    return created;
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

    const lifecycleFieldsChanged = [
      'propertyId',
      'hotelId',
      'departmentId',
      'positionId',
      'employmentType',
      'startDate',
    ].some((field) => Object.prototype.hasOwnProperty.call(updateEmployeeDto, field));

    if (lifecycleFieldsChanged) {
      await this.hrLifecycleAssignmentService
        .recomputeForEmployee(updated.id, tenantId!)
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Lifecycle recompute failed for employee ${updated.id}: ${msg}`);
        });
    }

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

    // ตำแหน่ง/แผนก: ผู้เรียกระบุมาก่อน → เดาจากแผนก HR ของพนักงาน → แม่บ้าน
    const resolvedRole =
      dto?.role ??
      inferStaffRoleFromDepartment(
        (employee as any).hrDepartment?.code,
        (employee as any).hrDepartment?.name ?? (employee as any).department,
      );
    const resolvedDepartment =
      dto?.department ?? (resolvedRole === 'technician' ? 'maintenance' : 'housekeeping');

    // ไปทางเดียวกับการเพิ่มพนักงานเองในหน้าแม่บ้าน — ถ้ามีแถวของคนนี้อยู่แล้ว
    // (เพิ่มไว้ตอนยังไม่ได้เชื่อม HR) จะถูกผูกให้ ไม่สร้างซ้ำ
    const { staff, action } = await this.staffService.provision(
      {
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        phone: (employee as any).phone ?? null,
        role: resolvedRole,
        department: resolvedDepartment,
        employeeCode: (employee as any).employeeCode ?? null,
        employeeId: employee.id,
      },
      tenantId,
    );

    if (action === 'existing') {
      throw new ConflictException(
        `Employee ${employeeId} already has a linked Staff record (${staff.id})`,
      );
    }

    this.logger.log(
      `Staff ${staff.id} (${resolvedRole}) ${action} for Employee ${employee.id} (tenant: ${tenantId})`,
    );

    return {
      success: true,
      data: staff,
      action,
      linkedEmployee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
      },
    };
  }

  /**
   * นำพนักงาน HR ขึ้นทะเบียนพนักงานปฏิบัติการทีเดียวหลายคน
   *
   * ของเดิมกวาด "พนักงานทุกคนใน tenant" แล้วยัดตำแหน่ง housekeeper /
   * แผนก housekeeping ให้ทุกคนแบบตายตัว โรงแรมที่มีพนักงาน 54 คนจึงได้แม่บ้าน
   * 54 คน รวมทั้งฝ่ายบัญชี ฝ่ายขาย และผู้บริหาร — ตอนนี้:
   *  • ตั้งต้นเฉพาะแผนกที่มีหน้างานจริง (HK, ENG) ผู้เรียกขยายเองได้
   *  • ตำแหน่งเดาจากแผนกรายคน (ENG → ช่าง, นอกนั้น → แม่บ้าน)
   *  • ข้ามคนที่พ้นสภาพแล้ว
   *  • คนที่มีอยู่บนทะเบียนแล้วจะถูก "ผูก" ไม่ใช่สร้างซ้ำ
   *
   * ยังคงเรียกซ้ำได้ปลอดภัย (idempotent) — คนที่ผูกแล้วจะถูกข้าม
   */
  async bulkCreateStaffFromEmployees(
    tenantId: string,
    options: BulkCreateStaffOptions = {},
  ): Promise<{
    created: number;
    linked: number;
    skipped: number;
    results: Array<{
      employeeId: string;
      employeeName: string;
      staffId?: string;
      status: 'created' | 'linked' | 'skipped';
      role?: string;
      reason?: string;
    }>;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: Prisma.EmployeeWhereInput = { tenantId };

    if (options.employeeIds?.length) {
      where.id = { in: options.employeeIds };
    } else if (options.departmentIds?.length) {
      where.departmentId = { in: options.departmentIds };
    } else if (!options.allDepartments) {
      // ค่าตั้งต้น: เฉพาะแผนกที่มีหน้างานในโรงแรม
      where.hrDepartment = { code: { in: OPERATIONAL_DEPARTMENT_CODES } };
    }

    if (!options.includeInactive) {
      where.status = { in: EMPLOYABLE_STATUSES };
    }

    const employees = await this.prisma.employee.findMany({
      where,
      include: { hrDepartment: true },
    });

    const results: Array<{
      employeeId: string;
      employeeName: string;
      staffId?: string;
      status: 'created' | 'linked' | 'skipped';
      role?: string;
      reason?: string;
    }> = [];
    let created = 0;
    let linked = 0;
    let skipped = 0;

    for (const employee of employees) {
      const employeeName = `${employee.firstName} ${employee.lastName}`;

      try {
        const role =
          options.role ??
          inferStaffRoleFromDepartment(
            (employee as any).hrDepartment?.code,
            (employee as any).hrDepartment?.name ?? employee.department,
          );

        const { staff, action } = await this.staffService.provision(
          {
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: employee.email,
            phone: employee.phone ?? null,
            role,
            department: role === 'technician' ? 'maintenance' : 'housekeeping',
            employeeCode: employee.employeeCode ?? null,
            employeeId: employee.id,
          },
          tenantId,
        );

        if (action === 'existing') {
          results.push({
            employeeId: employee.id,
            employeeName,
            staffId: staff.id,
            status: 'skipped',
            reason: 'Already linked to a Staff record',
          });
          skipped++;
          continue;
        }

        results.push({
          employeeId: employee.id,
          employeeName,
          staffId: staff.id,
          status: action,
          role,
        });
        if (action === 'created') created++;
        else linked++;

        this.logger.log(
          `Bulk sync: Staff ${staff.id} ${action} for Employee ${employee.id} (role=${role})`,
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
          this.logger.warn(`Bulk sync: skipped Employee ${employee.id} — ${reason}`);
        }
      }
    }

    this.logger.log(
      `Bulk sync finished for tenant ${tenantId}: created=${created} linked=${linked} skipped=${skipped}`,
    );

    return { created, linked, skipped, results };
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
