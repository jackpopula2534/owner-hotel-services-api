import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHrDepartmentDto } from './dto/create-hr-department.dto';
import { UpdateHrDepartmentDto } from './dto/update-hr-department.dto';
import { CreateHrPositionDto } from './dto/create-hr-position.dto';
import { UpdateHrPositionDto } from './dto/update-hr-position.dto';
import { CreateHrLeaveTypeDto } from './dto/create-hr-leave-type.dto';
import { CreateHrShiftTypeDto } from './dto/create-hr-shift-type.dto';
import { CreateHrAllowanceTypeDto } from './dto/create-hr-allowance-type.dto';
import { CreateHrDeductionTypeDto } from './dto/create-hr-deduction-type.dto';

@Injectable()
export class HrMasterDataService {
  private readonly logger = new Logger(HrMasterDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── DEPARTMENTS ─────────────────────────────────────────────────────────────

  async findAllDepartments(tenantId: string) {
    const departments = await this.prisma.hrDepartment.findMany({
      where: { tenantId },
      include: {
        positions: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { employees: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      success: true,
      data: departments,
      meta: { total: departments.length },
    };
  }

  async findOneDepartment(tenantId: string, id: string) {
    const department = await this.prisma.hrDepartment.findFirst({
      where: { id, tenantId },
      include: {
        positions: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { employees: true } },
      },
    });

    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }

    return { success: true, data: department };
  }

  async createDepartment(tenantId: string, dto: CreateHrDepartmentDto) {
    const existing = await this.prisma.hrDepartment.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
    });

    if (existing) {
      throw new ConflictException(`Department code '${dto.code}' already exists`);
    }

    const department = await this.prisma.hrDepartment.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        tenantId,
      },
    });

    this.logger.log(`Created department: ${department.name} (${department.code}) for tenant ${tenantId}`);
    return { success: true, data: department };
  }

  async updateDepartment(tenantId: string, id: string, dto: UpdateHrDepartmentDto) {
    const department = await this.prisma.hrDepartment.findFirst({
      where: { id, tenantId },
    });

    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }

    if (dto.code && dto.code.toUpperCase() !== department.code) {
      const codeConflict = await this.prisma.hrDepartment.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
      });
      if (codeConflict) {
        throw new ConflictException(`Department code '${dto.code}' already exists`);
      }
    }

    const updated = await this.prisma.hrDepartment.update({
      where: { id },
      data: { ...dto, ...(dto.code && { code: dto.code.toUpperCase() }) },
    });

    return { success: true, data: updated };
  }

  async removeDepartment(tenantId: string, id: string) {
    const department = await this.prisma.hrDepartment.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { employees: true, positions: true } } },
    });

    if (!department) {
      throw new NotFoundException(`Department with ID ${id} not found`);
    }

    if (department._count.employees > 0) {
      throw new ConflictException(
        `Cannot delete department with ${department._count.employees} active employee(s). Please reassign employees first.`,
      );
    }

    await this.prisma.hrDepartment.delete({ where: { id } });
    return { success: true, message: 'Department deleted successfully' };
  }

  // ─── POSITIONS ────────────────────────────────────────────────────────────────

  async findAllPositions(tenantId: string, departmentId?: string) {
    const positions = await this.prisma.hrPosition.findMany({
      where: { tenantId, ...(departmentId && { departmentId }) },
      include: {
        department: { select: { id: true, name: true, code: true, color: true } },
        _count: { select: { employees: true } },
      },
      orderBy: [{ department: { sortOrder: 'asc' } }, { level: 'desc' }, { sortOrder: 'asc' }],
    });

    return {
      success: true,
      data: positions,
      meta: { total: positions.length },
    };
  }

  async findOnePosition(tenantId: string, id: string) {
    const position = await this.prisma.hrPosition.findFirst({
      where: { id, tenantId },
      include: {
        department: true,
        _count: { select: { employees: true } },
      },
    });

    if (!position) {
      throw new NotFoundException(`Position with ID ${id} not found`);
    }

    return { success: true, data: position };
  }

  async createPosition(tenantId: string, dto: CreateHrPositionDto) {
    const department = await this.prisma.hrDepartment.findFirst({
      where: { id: dto.departmentId, tenantId },
    });

    if (!department) {
      throw new NotFoundException(`Department with ID ${dto.departmentId} not found`);
    }

    const position = await this.prisma.hrPosition.create({
      data: { ...dto, tenantId },
      include: {
        department: { select: { id: true, name: true, code: true, color: true } },
      },
    });

    this.logger.log(`Created position: ${position.name} under ${department.name}`);
    return { success: true, data: position };
  }

  async updatePosition(tenantId: string, id: string, dto: UpdateHrPositionDto) {
    const position = await this.prisma.hrPosition.findFirst({
      where: { id, tenantId },
    });

    if (!position) {
      throw new NotFoundException(`Position with ID ${id} not found`);
    }

    if (dto.departmentId && dto.departmentId !== position.departmentId) {
      const dept = await this.prisma.hrDepartment.findFirst({
        where: { id: dto.departmentId, tenantId },
      });
      if (!dept) {
        throw new NotFoundException(`Department with ID ${dto.departmentId} not found`);
      }
    }

    const updated = await this.prisma.hrPosition.update({
      where: { id },
      data: dto,
      include: {
        department: { select: { id: true, name: true, code: true, color: true } },
      },
    });

    return { success: true, data: updated };
  }

  async removePosition(tenantId: string, id: string) {
    const position = await this.prisma.hrPosition.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { employees: true } } },
    });

    if (!position) {
      throw new NotFoundException(`Position with ID ${id} not found`);
    }

    if (position._count.employees > 0) {
      throw new ConflictException(
        `Cannot delete position with ${position._count.employees} active employee(s). Please reassign employees first.`,
      );
    }

    await this.prisma.hrPosition.delete({ where: { id } });
    return { success: true, message: 'Position deleted successfully' };
  }

  // ─── LEAVE TYPES ─────────────────────────────────────────────────────────────

  async findAllLeaveTypes(tenantId: string) {
    const leaveTypes = await this.prisma.hrLeaveType.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return { success: true, data: leaveTypes, meta: { total: leaveTypes.length } };
  }

  async createLeaveType(tenantId: string, dto: CreateHrLeaveTypeDto) {
    const existing = await this.prisma.hrLeaveType.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
    });
    if (existing) {
      throw new ConflictException(`Leave type code '${dto.code}' already exists`);
    }

    const leaveType = await this.prisma.hrLeaveType.create({
      data: { ...dto, code: dto.code.toUpperCase(), tenantId },
    });

    return { success: true, data: leaveType };
  }

  async updateLeaveType(tenantId: string, id: string, dto: Partial<CreateHrLeaveTypeDto>) {
    const leaveType = await this.prisma.hrLeaveType.findFirst({ where: { id, tenantId } });
    if (!leaveType) throw new NotFoundException(`Leave type with ID ${id} not found`);

    const updated = await this.prisma.hrLeaveType.update({
      where: { id },
      data: { ...dto, ...(dto.code && { code: dto.code.toUpperCase() }) },
    });
    return { success: true, data: updated };
  }

  async removeLeaveType(tenantId: string, id: string) {
    const leaveType = await this.prisma.hrLeaveType.findFirst({ where: { id, tenantId } });
    if (!leaveType) throw new NotFoundException(`Leave type with ID ${id} not found`);

    await this.prisma.hrLeaveType.delete({ where: { id } });
    return { success: true, message: 'Leave type deleted successfully' };
  }

  // ─── SHIFT TYPES ─────────────────────────────────────────────────────────────

  async findAllShiftTypes(tenantId: string) {
    const shiftTypes = await this.prisma.hrShiftType.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return { success: true, data: shiftTypes, meta: { total: shiftTypes.length } };
  }

  async createShiftType(tenantId: string, dto: CreateHrShiftTypeDto) {
    const existing = await this.prisma.hrShiftType.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
    });
    if (existing) {
      throw new ConflictException(`Shift type code '${dto.code}' already exists`);
    }

    const shiftType = await this.prisma.hrShiftType.create({
      data: { ...dto, code: dto.code.toUpperCase(), tenantId },
    });

    return { success: true, data: shiftType };
  }

  async updateShiftType(tenantId: string, id: string, dto: Partial<CreateHrShiftTypeDto>) {
    const shiftType = await this.prisma.hrShiftType.findFirst({ where: { id, tenantId } });
    if (!shiftType) throw new NotFoundException(`Shift type with ID ${id} not found`);

    const updated = await this.prisma.hrShiftType.update({
      where: { id },
      data: { ...dto, ...(dto.code && { code: dto.code.toUpperCase() }) },
    });
    return { success: true, data: updated };
  }

  async removeShiftType(tenantId: string, id: string) {
    const shiftType = await this.prisma.hrShiftType.findFirst({ where: { id, tenantId } });
    if (!shiftType) throw new NotFoundException(`Shift type with ID ${id} not found`);

    await this.prisma.hrShiftType.delete({ where: { id } });
    return { success: true, message: 'Shift type deleted successfully' };
  }

  // ─── ALLOWANCE TYPES ─────────────────────────────────────────────────────────

  async findAllAllowanceTypes(tenantId: string) {
    const allowanceTypes = await this.prisma.hrAllowanceType.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return { success: true, data: allowanceTypes, meta: { total: allowanceTypes.length } };
  }

  async createAllowanceType(tenantId: string, dto: CreateHrAllowanceTypeDto) {
    const existing = await this.prisma.hrAllowanceType.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
    });
    if (existing) {
      throw new ConflictException(`Allowance type code '${dto.code}' already exists`);
    }

    const allowanceType = await this.prisma.hrAllowanceType.create({
      data: { ...dto, code: dto.code.toUpperCase(), tenantId },
    });

    return { success: true, data: allowanceType };
  }

  async updateAllowanceType(tenantId: string, id: string, dto: Partial<CreateHrAllowanceTypeDto>) {
    const allowanceType = await this.prisma.hrAllowanceType.findFirst({ where: { id, tenantId } });
    if (!allowanceType) throw new NotFoundException(`Allowance type with ID ${id} not found`);

    const updated = await this.prisma.hrAllowanceType.update({
      where: { id },
      data: { ...dto, ...(dto.code && { code: dto.code.toUpperCase() }) },
    });
    return { success: true, data: updated };
  }

  async removeAllowanceType(tenantId: string, id: string) {
    const allowanceType = await this.prisma.hrAllowanceType.findFirst({ where: { id, tenantId } });
    if (!allowanceType) throw new NotFoundException(`Allowance type with ID ${id} not found`);

    await this.prisma.hrAllowanceType.delete({ where: { id } });
    return { success: true, message: 'Allowance type deleted successfully' };
  }

  // ─── DEDUCTION TYPES ─────────────────────────────────────────────────────────

  async findAllDeductionTypes(tenantId: string) {
    const deductionTypes = await this.prisma.hrDeductionType.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
    return { success: true, data: deductionTypes, meta: { total: deductionTypes.length } };
  }

  async createDeductionType(tenantId: string, dto: CreateHrDeductionTypeDto) {
    const existing = await this.prisma.hrDeductionType.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code.toUpperCase() } },
    });
    if (existing) {
      throw new ConflictException(`Deduction type code '${dto.code}' already exists`);
    }

    const deductionType = await this.prisma.hrDeductionType.create({
      data: { ...dto, code: dto.code.toUpperCase(), tenantId },
    });

    return { success: true, data: deductionType };
  }

  async updateDeductionType(tenantId: string, id: string, dto: Partial<CreateHrDeductionTypeDto>) {
    const deductionType = await this.prisma.hrDeductionType.findFirst({ where: { id, tenantId } });
    if (!deductionType) throw new NotFoundException(`Deduction type with ID ${id} not found`);

    const updated = await this.prisma.hrDeductionType.update({
      where: { id },
      data: { ...dto, ...(dto.code && { code: dto.code.toUpperCase() }) },
    });
    return { success: true, data: updated };
  }

  async removeDeductionType(tenantId: string, id: string) {
    const deductionType = await this.prisma.hrDeductionType.findFirst({ where: { id, tenantId } });
    if (!deductionType) throw new NotFoundException(`Deduction type with ID ${id} not found`);

    await this.prisma.hrDeductionType.delete({ where: { id } });
    return { success: true, message: 'Deduction type deleted successfully' };
  }

  // ─── SUMMARY (get all master data at once) ───────────────────────────────────

  async getSummary(tenantId: string) {
    const [departments, positions, leaveTypes, shiftTypes, allowanceTypes, deductionTypes] =
      await Promise.all([
        this.prisma.hrDepartment.findMany({
          where: { tenantId, isActive: true },
          include: { _count: { select: { employees: true } } },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.hrPosition.findMany({
          where: { tenantId, isActive: true },
          include: { department: { select: { id: true, name: true, code: true, color: true } } },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.hrLeaveType.findMany({
          where: { tenantId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.hrShiftType.findMany({
          where: { tenantId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.hrAllowanceType.findMany({
          where: { tenantId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.hrDeductionType.findMany({
          where: { tenantId, isActive: true },
          orderBy: { sortOrder: 'asc' },
        }),
      ]);

    return {
      success: true,
      data: { departments, positions, leaveTypes, shiftTypes, allowanceTypes, deductionTypes },
    };
  }

  // ─── INITIALIZE DEFAULTS (for new tenants) ───────────────────────────────────

  async initializeDefaults(tenantId: string): Promise<{
    success: boolean;
    data: { created: Record<string, number>; skipped: Record<string, number> };
    message: string;
  }> {
    this.logger.log(`Initializing default HR master data for tenant: ${tenantId}`);

    const created: Record<string, number> = {
      departments: 0, positions: 0, leaveTypes: 0,
      shiftTypes: 0, allowanceTypes: 0, deductionTypes: 0,
    };
    const skipped: Record<string, number> = {
      departments: 0, positions: 0, leaveTypes: 0,
      shiftTypes: 0, allowanceTypes: 0, deductionTypes: 0,
    };

    // ─── Department + Position templates ───────────────────────────────────────
    const departmentTemplates = [
      { name: 'ฝ่ายต้อนรับ', nameEn: 'Front Office', code: 'FO', color: '#8B5CF6', sortOrder: 1, description: 'บริการต้อนรับแขก เช็คอิน/เช็คเอาท์ คอนเซียจ' },
      { name: 'ฝ่ายซ่อมบำรุง / ทำความสะอาด', nameEn: 'Housekeeping & Maintenance', code: 'HK', color: '#10B981', sortOrder: 2, description: 'ทำความสะอาดห้องพัก พื้นที่ส่วนกลาง ซักรีด และซ่อมบำรุงทั่วไป' },
      { name: 'ฝ่ายอาหารและเครื่องดื่ม', nameEn: 'Food & Beverage', code: 'FB', color: '#F59E0B', sortOrder: 3, description: 'ร้านอาหาร บาร์ รูมเซอร์วิส จัดเลี้ยง' },
      { name: 'ฝ่ายวิศวกรรม', nameEn: 'Engineering', code: 'ENG', color: '#EF4444', sortOrder: 4, description: 'บำรุงรักษา ระบบไฟฟ้า ประปา HVAC ไอที' },
      { name: 'ฝ่ายทรัพยากรบุคคล', nameEn: 'Human Resources', code: 'HR', color: '#EC4899', sortOrder: 5, description: 'สรรหา ฝึกอบรม เงินเดือน สวัสดิการ' },
      { name: 'ฝ่ายการเงินและบัญชี', nameEn: 'Finance & Accounting', code: 'FIN', color: '#06B6D4', sortOrder: 6, description: 'บัญชี การเงิน จัดซื้อ คลังสินค้า' },
      { name: 'ฝ่ายขายและการตลาด', nameEn: 'Sales & Marketing', code: 'SM', color: '#F97316', sortOrder: 7, description: 'ขาย การตลาด ประชาสัมพันธ์ OTA จัดการ' },
      { name: 'ฝ่ายรักษาความปลอดภัย', nameEn: 'Security', code: 'SEC', color: '#6B7280', sortOrder: 8, description: 'รักษาความปลอดภัย ควบคุมการเข้าออก' },
      { name: 'ฝ่ายสปาและนันทนาการ', nameEn: 'Spa & Recreation', code: 'SPA', color: '#A78BFA', sortOrder: 9, description: 'สปา ฟิตเนส สระว่ายน้ำ กิจกรรมแขก' },
      { name: 'ฝ่ายบริหาร', nameEn: 'Management', code: 'MGT', color: '#1D4ED8', sortOrder: 10, description: 'ผู้บริหารระดับสูง ผู้จัดการทั่วไป' },
    ];

    const positionTemplates: Record<string, Array<{ name: string; nameEn: string; level: number; sortOrder: number }>> = {
      FO: [
        { name: 'ผู้จัดการฝ่ายต้อนรับ', nameEn: 'Front Office Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการเวร', nameEn: 'Duty Manager', level: 7, sortOrder: 2 },
        { name: 'พนักงานต้อนรับ (กะกลางวัน)', nameEn: 'Front Desk Agent', level: 4, sortOrder: 3 },
        { name: 'พนักงานต้อนรับ (กะกลางคืน)', nameEn: 'Night Auditor', level: 4, sortOrder: 4 },
        { name: 'คอนเซียจ', nameEn: 'Concierge', level: 5, sortOrder: 5 },
        { name: 'เจ้าหน้าที่ Guest Relations', nameEn: 'Guest Relations Officer', level: 5, sortOrder: 6 },
        { name: 'พนักงานยกกระเป๋า', nameEn: 'Bellman', level: 3, sortOrder: 7 },
        { name: 'เจ้าหน้าที่จองห้องพัก', nameEn: 'Reservation Agent', level: 4, sortOrder: 8 },
      ],
      HK: [
        { name: 'หัวหน้าแม่บ้าน', nameEn: 'Executive Housekeeper', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยหัวหน้าแม่บ้าน', nameEn: 'Assistant Housekeeper', level: 7, sortOrder: 2 },
        { name: 'หัวหน้าชั้น', nameEn: 'Floor Supervisor', level: 6, sortOrder: 3 },
        { name: 'แม่บ้านห้องพัก', nameEn: 'Room Attendant', level: 3, sortOrder: 4 },
        { name: 'พนักงานซักรีด', nameEn: 'Laundry Attendant', level: 3, sortOrder: 5 },
        { name: 'พนักงานทำความสะอาดพื้นที่ส่วนกลาง', nameEn: 'Public Area Cleaner', level: 2, sortOrder: 6 },
      ],
      FB: [
        { name: 'ผู้จัดการอาหารและเครื่องดื่ม', nameEn: 'F&B Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการร้านอาหาร', nameEn: 'Restaurant Manager', level: 7, sortOrder: 2 },
        { name: 'พ่อครัวใหญ่', nameEn: 'Head Chef', level: 8, sortOrder: 3 },
        { name: 'พ่อครัวแต่ละส่วน', nameEn: 'Chef de Partie', level: 6, sortOrder: 4 },
        { name: 'บาริสต้า', nameEn: 'Barista', level: 4, sortOrder: 5 },
        { name: 'บาร์เทนเดอร์', nameEn: 'Bartender', level: 4, sortOrder: 6 },
        { name: 'พนักงานเสิร์ฟ', nameEn: 'Waiter / Waitress', level: 3, sortOrder: 7 },
        { name: 'พนักงานรูมเซอร์วิส', nameEn: 'Room Service Attendant', level: 3, sortOrder: 8 },
      ],
      ENG: [
        { name: 'หัวหน้าวิศวกร', nameEn: 'Chief Engineer', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยวิศวกร', nameEn: 'Assistant Engineer', level: 7, sortOrder: 2 },
        { name: 'ช่างไฟฟ้า', nameEn: 'Electrician', level: 5, sortOrder: 3 },
        { name: 'ช่างประปา', nameEn: 'Plumber', level: 5, sortOrder: 4 },
        { name: 'ช่างปรับอากาศ (HVAC)', nameEn: 'HVAC Technician', level: 5, sortOrder: 5 },
        { name: 'ช่างทั่วไป', nameEn: 'General Maintenance', level: 3, sortOrder: 6 },
      ],
      HR: [
        { name: 'ผู้จัดการฝ่าย HR', nameEn: 'HR Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ HR', nameEn: 'HR Officer', level: 5, sortOrder: 2 },
        { name: 'เจ้าหน้าที่ฝึกอบรม', nameEn: 'Training Coordinator', level: 5, sortOrder: 3 },
        { name: 'เจ้าหน้าที่เงินเดือน', nameEn: 'Payroll Officer', level: 5, sortOrder: 4 },
      ],
      FIN: [
        { name: 'ผู้ควบคุมการเงิน', nameEn: 'Financial Controller', level: 9, sortOrder: 1 },
        { name: 'หัวหน้าบัญชี', nameEn: 'Chief Accountant', level: 8, sortOrder: 2 },
        { name: 'นักบัญชี', nameEn: 'Accountant', level: 6, sortOrder: 3 },
        { name: 'เจ้าหน้าที่จัดซื้อ', nameEn: 'Purchasing Officer', level: 5, sortOrder: 4 },
      ],
      SM: [
        { name: 'ผู้จัดการฝ่ายขาย', nameEn: 'Sales Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ขาย', nameEn: 'Sales Executive', level: 6, sortOrder: 2 },
        { name: 'เจ้าหน้าที่การตลาด', nameEn: 'Marketing Executive', level: 6, sortOrder: 3 },
        { name: 'Revenue Manager', nameEn: 'Revenue Manager', level: 7, sortOrder: 4 },
      ],
      SEC: [
        { name: 'ผู้จัดการรักษาความปลอดภัย', nameEn: 'Security Manager', level: 7, sortOrder: 1 },
        { name: 'หัวหน้าเวรรักษาความปลอดภัย', nameEn: 'Security Supervisor', level: 6, sortOrder: 2 },
        { name: 'พนักงานรักษาความปลอดภัย', nameEn: 'Security Officer', level: 3, sortOrder: 3 },
      ],
      SPA: [
        { name: 'ผู้จัดการสปา', nameEn: 'Spa Manager', level: 7, sortOrder: 1 },
        { name: 'นักบำบัด', nameEn: 'Therapist', level: 5, sortOrder: 2 },
        { name: 'ผู้ฝึกสอนฟิตเนส', nameEn: 'Fitness Instructor', level: 5, sortOrder: 3 },
        { name: 'พนักงานดูแลสระว่ายน้ำ', nameEn: 'Pool Attendant', level: 3, sortOrder: 4 },
      ],
      MGT: [
        { name: 'ผู้จัดการทั่วไป', nameEn: 'General Manager', level: 10, sortOrder: 1 },
        { name: 'ผู้จัดการโรงแรม', nameEn: 'Resident Manager', level: 9, sortOrder: 2 },
        { name: 'ผู้ช่วยผู้จัดการทั่วไป', nameEn: 'Assistant General Manager', level: 8, sortOrder: 3 },
      ],
    };

    const leaveTypeTemplates = [
      { name: 'ลาพักร้อน', nameEn: 'Annual Leave', code: 'ANNUAL', maxDaysPerYear: 15, isPaid: true, requiresDoc: false, color: '#10B981', sortOrder: 1, description: 'ลาพักร้อนประจำปี' },
      { name: 'ลาป่วย', nameEn: 'Sick Leave', code: 'SICK', maxDaysPerYear: 30, isPaid: true, requiresDoc: false, color: '#EF4444', sortOrder: 2, description: 'ลาเนื่องจากเจ็บป่วย' },
      { name: 'ลากิจ', nameEn: 'Personal Leave', code: 'PERSONAL', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#F59E0B', sortOrder: 3, description: 'ลากิจส่วนตัว' },
      { name: 'ลาคลอด', nameEn: 'Maternity Leave', code: 'MATERNITY', maxDaysPerYear: 90, isPaid: true, requiresDoc: true, color: '#EC4899', sortOrder: 4, description: 'ลาคลอดบุตร' },
      { name: 'ลาเพื่อดูแลภรรยาคลอด', nameEn: 'Paternity Leave', code: 'PATERNITY', maxDaysPerYear: 15, isPaid: true, requiresDoc: true, color: '#3B82F6', sortOrder: 5, description: 'ลาเพื่อดูแลภรรยาคลอด' },
      { name: 'ลาแต่งงาน', nameEn: 'Marriage Leave', code: 'MARRIAGE', maxDaysPerYear: 3, isPaid: true, requiresDoc: true, color: '#A78BFA', sortOrder: 6, description: 'ลาแต่งงาน' },
      { name: 'ลาไว้ทุกข์', nameEn: 'Bereavement Leave', code: 'BEREAVEMENT', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#6B7280', sortOrder: 7, description: 'ลาไว้ทุกข์' },
      { name: 'ลาอบรม/สัมมนา', nameEn: 'Training Leave', code: 'TRAINING', maxDaysPerYear: null, isPaid: true, requiresDoc: false, color: '#06B6D4', sortOrder: 8, description: 'ลาเพื่อเข้ารับการอบรม' },
      { name: 'ลาไม่รับเงินเดือน', nameEn: 'Unpaid Leave', code: 'UNPAID', maxDaysPerYear: null, isPaid: false, requiresDoc: false, color: '#D1D5DB', sortOrder: 9, description: 'ลาโดยไม่รับเงินเดือน' },
    ];

    const shiftTypeTemplates = [
      { name: 'กะเช้า', nameEn: 'Morning Shift', code: 'MORNING', startTime: '07:00', endTime: '15:00', breakMinutes: 60, color: '#F59E0B', sortOrder: 1, description: '07:00-15:00 น.' },
      { name: 'กะบ่าย', nameEn: 'Afternoon Shift', code: 'AFTERNOON', startTime: '15:00', endTime: '23:00', breakMinutes: 60, color: '#8B5CF6', sortOrder: 2, description: '15:00-23:00 น.' },
      { name: 'กะดึก', nameEn: 'Night Shift', code: 'NIGHT', startTime: '23:00', endTime: '07:00', breakMinutes: 60, color: '#1E40AF', sortOrder: 3, description: '23:00-07:00 น.' },
      { name: 'เวลาทำการปกติ', nameEn: 'Office Hours', code: 'OFFICE', startTime: '09:00', endTime: '18:00', breakMinutes: 60, color: '#10B981', sortOrder: 4, description: '09:00-18:00 น.' },
      { name: 'ยืดหยุ่น', nameEn: 'Flexible Hours', code: 'FLEXIBLE', startTime: '08:00', endTime: '17:00', breakMinutes: 60, color: '#6B7280', sortOrder: 5, description: 'เวลาทำงานยืดหยุ่น' },
    ];

    const allowanceTypeTemplates = [
      { name: 'เซอร์วิสชาร์จ', nameEn: 'Service Charge', code: 'SERVICE_CHARGE', isTaxable: true, sortOrder: 1, description: 'ค่าบริการแบ่งให้พนักงาน' },
      { name: 'ค่าอาหาร', nameEn: 'Meal Allowance', code: 'MEAL', isTaxable: false, sortOrder: 2, description: 'เบี้ยเลี้ยงค่าอาหาร' },
      { name: 'ค่าเดินทาง', nameEn: 'Transportation Allowance', code: 'TRANSPORT', isTaxable: false, sortOrder: 3, description: 'ค่าใช้จ่ายการเดินทาง' },
      { name: 'ค่าล่วงเวลา', nameEn: 'Overtime Pay', code: 'OVERTIME', isTaxable: true, sortOrder: 4, description: 'ค่าจ้างการทำงานล่วงเวลา' },
      { name: 'เบี้ยกะ', nameEn: 'Shift Allowance', code: 'SHIFT', isTaxable: false, sortOrder: 5, description: 'เบี้ยเลี้ยงสำหรับการทำงานกะ' },
      { name: 'โบนัสประจำปี', nameEn: 'Annual Bonus', code: 'BONUS', isTaxable: true, sortOrder: 6, description: 'โบนัสประจำปีตามผลประกอบการ' },
    ];

    const deductionTypeTemplates = [
      { name: 'ภาษีเงินได้บุคคลธรรมดา', nameEn: 'Personal Income Tax', code: 'INCOME_TAX', isRequired: true, sortOrder: 1, description: 'ภาษีเงินได้หัก ณ ที่จ่าย' },
      { name: 'ประกันสังคม', nameEn: 'Social Security', code: 'SOCIAL_SECURITY', isRequired: true, sortOrder: 2, description: 'เงินสมทบกองทุนประกันสังคม 5%' },
      { name: 'กองทุนสำรองเลี้ยงชีพ', nameEn: 'Provident Fund', code: 'PROVIDENT_FUND', isRequired: false, sortOrder: 3, description: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ' },
      { name: 'เงินกู้พนักงาน', nameEn: 'Employee Loan', code: 'EMPLOYEE_LOAN', isRequired: false, sortOrder: 4, description: 'หักคืนเงินกู้จากโรงแรม' },
      { name: 'หักขาดงาน', nameEn: 'Absence Deduction', code: 'ABSENCE', isRequired: false, sortOrder: 5, description: 'หักเงินกรณีขาดงานโดยไม่มีเหตุ' },
    ];

    // ─── Upsert Departments + Positions ────────────────────────────────────────
    for (const deptTpl of departmentTemplates) {
      const existing = await this.prisma.hrDepartment.findUnique({
        where: { tenantId_code: { tenantId, code: deptTpl.code } },
      });

      if (existing) {
        skipped.departments++;
        continue;
      }

      const dept = await this.prisma.hrDepartment.create({
        data: { ...deptTpl, tenantId, isActive: true },
      });
      created.departments++;

      const positionList = positionTemplates[deptTpl.code] ?? [];
      for (const posTpl of positionList) {
        await this.prisma.hrPosition.create({
          data: {
            tenantId,
            departmentId: dept.id,
            name: posTpl.name,
            nameEn: posTpl.nameEn,
            level: posTpl.level,
            isActive: true,
            sortOrder: posTpl.sortOrder,
          },
        });
        created.positions++;
      }
    }

    // ─── Upsert Leave Types ────────────────────────────────────────────────────
    for (const lt of leaveTypeTemplates) {
      const existing = await this.prisma.hrLeaveType.findUnique({
        where: { tenantId_code: { tenantId, code: lt.code } },
      });
      if (existing) { skipped.leaveTypes++; continue; }
      await this.prisma.hrLeaveType.create({ data: { ...lt, tenantId, isActive: true } });
      created.leaveTypes++;
    }

    // ─── Upsert Shift Types ────────────────────────────────────────────────────
    for (const st of shiftTypeTemplates) {
      const existing = await this.prisma.hrShiftType.findUnique({
        where: { tenantId_code: { tenantId, code: st.code } },
      });
      if (existing) { skipped.shiftTypes++; continue; }
      await this.prisma.hrShiftType.create({ data: { ...st, tenantId, isActive: true } });
      created.shiftTypes++;
    }

    // ─── Upsert Allowance Types ────────────────────────────────────────────────
    for (const at of allowanceTypeTemplates) {
      const existing = await this.prisma.hrAllowanceType.findUnique({
        where: { tenantId_code: { tenantId, code: at.code } },
      });
      if (existing) { skipped.allowanceTypes++; continue; }
      await this.prisma.hrAllowanceType.create({ data: { ...at, tenantId, isActive: true } });
      created.allowanceTypes++;
    }

    // ─── Upsert Deduction Types ────────────────────────────────────────────────
    for (const dt of deductionTypeTemplates) {
      const existing = await this.prisma.hrDeductionType.findUnique({
        where: { tenantId_code: { tenantId, code: dt.code } },
      });
      if (existing) { skipped.deductionTypes++; continue; }
      await this.prisma.hrDeductionType.create({ data: { ...dt, tenantId, isActive: true } });
      created.deductionTypes++;
    }

    const totalCreated = Object.values(created).reduce((a, b) => a + b, 0);
    this.logger.log(`Initialized HR defaults for tenant ${tenantId}: ${totalCreated} records created`);

    return {
      success: true,
      data: { created, skipped },
      message: totalCreated > 0
        ? `สร้างข้อมูลเริ่มต้นสำเร็จ: ${created.departments} แผนก, ${created.positions} ตำแหน่ง, ${created.leaveTypes} ประเภทการลา`
        : 'ข้อมูลเริ่มต้นมีอยู่แล้วทั้งหมด ไม่มีการสร้างใหม่',
    };
  }
}
