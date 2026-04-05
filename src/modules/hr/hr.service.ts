import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { department, position, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (department) (where as any).department = department;
    if (position) (where as any).position = position;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { employeeCode: { contains: search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma.employee as any).findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { staff: { select: { id: true, role: true, status: true } } },
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
      include: { staff: { select: { id: true, role: true, status: true, department: true } } },
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

    return this.prisma.employee.create({
      data: { ...createEmployeeDto, tenantId },
    });
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto, tenantId?: string) {
    const employee = await this.findOne(id, tenantId);

    const updated = await (this.prisma.employee as any).update({
      where: { id },
      data: updateEmployeeDto,
      include: { staff: true },
    }) as any;

    // Auto-sync basic info to linked Staff record if one exists
    if (updated.staff) {
      await this.syncEmployeeToStaff(updated.staff.id, updated).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-sync to Staff ${updated.staff.id} failed: ${msg}`);
      });
    }

    return updated;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    // onDelete: SetNull — Staff.employeeId is cleared automatically by DB FK
    return this.prisma.employee.delete({ where: { id } });
  }

  /**
   * Create a Staff record linked to an existing Employee (HR Add-on bridge).
   * The Staff inherits first/last name, email, department and employeeCode.
   * The role defaults to 'housekeeper' — caller can update via Staff CRUD.
   */
  async createStaffFromEmployee(employeeId: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const employee = await this.findOne(employeeId, tenantId);

    // Guard: already linked (cast to any — employeeId added in latest migration)
    const existingStaff = await (this.prisma.staff as any).findUnique({
      where: { employeeId },
    });
    if (existingStaff) {
      throw new ConflictException(
        `Employee ${employeeId} already has a linked Staff record (${existingStaff.id})`,
      );
    }

    const staff = await (this.prisma.staff as any).create({
      data: {
        tenantId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        employeeCode: employee.employeeCode ?? undefined,
        department: employee.department ?? 'housekeeping',
        role: 'housekeeper',
        status: 'active',
        employeeId: employee.id,  // new field from latest migration
      },
    });

    this.logger.log(
      `Staff ${staff.id} created and linked to Employee ${employee.id} (tenant: ${tenantId})`,
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
