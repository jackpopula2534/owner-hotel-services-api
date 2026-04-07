import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Service สำหรับสร้างข้อมูลเริ่มต้น (Departments, Positions, Leave Types, Shifts, etc.)
 * ให้กับ Tenant ที่พึ่งสร้างใหม่ — เรียกใช้ใน createHotel() flow
 */
@Injectable()
export class TenantDefaultDataService {
  private readonly logger = new Logger(TenantDefaultDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * สร้างข้อมูลเริ่มต้นทั้งหมดสำหรับ tenant ใหม่
   * รวม: Departments, Positions, Leave Types, Shift Types, Allowance Types, Deduction Types
   */
  async seedDefaultData(tenantId: string): Promise<void> {
    this.logger.log(`Seeding default HR master data for tenant: ${tenantId}`);

    try {
      await this.seedDepartmentsAndPositions(tenantId);
      await this.seedLeaveTypes(tenantId);
      await this.seedShiftTypes(tenantId);
      await this.seedAllowanceTypes(tenantId);
      await this.seedDeductionTypes(tenantId);

      this.logger.log(`Default HR master data seeded successfully for tenant: ${tenantId}`);
    } catch (error) {
      this.logger.error(
        `Failed to seed default data for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // ไม่ throw — ไม่ให้ tenant creation fail เพราะ default data
    }
  }

  // ─── Department & Position Templates ─────────────────────────────────────

  private getDepartmentTemplates() {
    return [
      { name: 'ฝ่ายต้อนรับ', nameEn: 'Front Office', code: 'FO', color: '#8B5CF6', sortOrder: 1, description: 'บริการต้อนรับแขก เช็คอิน/เช็คเอาท์ คอนเซียจ' },
      { name: 'ฝ่ายแม่บ้าน', nameEn: 'Housekeeping', code: 'HK', color: '#10B981', sortOrder: 2, description: 'ทำความสะอาดห้องพัก พื้นที่ส่วนกลาง ซักรีด' },
      { name: 'ฝ่ายอาหารและเครื่องดื่ม', nameEn: 'Food & Beverage', code: 'FB', color: '#F59E0B', sortOrder: 3, description: 'ร้านอาหาร บาร์ รูมเซอร์วิส จัดเลี้ยง' },
      { name: 'ฝ่ายวิศวกรรม', nameEn: 'Engineering', code: 'ENG', color: '#EF4444', sortOrder: 4, description: 'บำรุงรักษา ระบบไฟฟ้า ประปา HVAC ไอที' },
      { name: 'ฝ่ายทรัพยากรบุคคล', nameEn: 'Human Resources', code: 'HR', color: '#EC4899', sortOrder: 5, description: 'สรรหา ฝึกอบรม เงินเดือน สวัสดิการ' },
      { name: 'ฝ่ายการเงินและบัญชี', nameEn: 'Finance & Accounting', code: 'FIN', color: '#06B6D4', sortOrder: 6, description: 'บัญชี การเงิน จัดซื้อ คลังสินค้า' },
      { name: 'ฝ่ายขายและการตลาด', nameEn: 'Sales & Marketing', code: 'SM', color: '#F97316', sortOrder: 7, description: 'ขาย การตลาด ประชาสัมพันธ์ OTA จัดการ' },
      { name: 'ฝ่ายรักษาความปลอดภัย', nameEn: 'Security', code: 'SEC', color: '#6B7280', sortOrder: 8, description: 'รักษาความปลอดภัย ควบคุมการเข้าออก' },
      { name: 'ฝ่ายสปาและนันทนาการ', nameEn: 'Spa & Recreation', code: 'SPA', color: '#A78BFA', sortOrder: 9, description: 'สปา ฟิตเนส สระว่ายน้ำ กิจกรรมแขก' },
      { name: 'ฝ่ายบริหาร', nameEn: 'Management', code: 'MGT', color: '#1D4ED8', sortOrder: 10, description: 'ผู้บริหารระดับสูง ผู้จัดการทั่วไป' },
    ];
  }

  private getPositionTemplates(): Record<string, Array<{ name: string; nameEn: string; level: number; sortOrder: number }>> {
    return {
      FO: [
        { name: 'ผู้จัดการฝ่ายต้อนรับ', nameEn: 'Front Office Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการเวร', nameEn: 'Duty Manager', level: 7, sortOrder: 2 },
        { name: 'พนักงานต้อนรับ (กะกลางวัน)', nameEn: 'Front Desk Agent (Day Shift)', level: 4, sortOrder: 3 },
        { name: 'พนักงานต้อนรับ (กะกลางคืน)', nameEn: 'Night Auditor', level: 4, sortOrder: 4 },
        { name: 'คอนเซียจ', nameEn: 'Concierge', level: 5, sortOrder: 5 },
        { name: 'หัวหน้าพนักงานยกกระเป๋า', nameEn: 'Bell Captain', level: 5, sortOrder: 6 },
        { name: 'พนักงานยกกระเป๋า', nameEn: 'Bellman', level: 3, sortOrder: 7 },
        { name: 'เจ้าหน้าที่ Reception', nameEn: 'Reservation Agent', level: 4, sortOrder: 8 },
        { name: 'เจ้าหน้าที่ Guest Relations', nameEn: 'Guest Relations Officer', level: 5, sortOrder: 9 },
      ],
      HK: [
        { name: 'หัวหน้าแม่บ้าน', nameEn: 'Executive Housekeeper', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยหัวหน้าแม่บ้าน', nameEn: 'Assistant Housekeeper', level: 7, sortOrder: 2 },
        { name: 'หัวหน้าชั้น', nameEn: 'Floor Supervisor', level: 6, sortOrder: 3 },
        { name: 'แม่บ้านห้องพัก', nameEn: 'Room Attendant', level: 3, sortOrder: 4 },
        { name: 'พนักงานซักรีด', nameEn: 'Laundry Attendant', level: 3, sortOrder: 5 },
        { name: 'พนักงานทำความสะอาดพื้นที่ส่วนกลาง', nameEn: 'Public Area Cleaner', level: 2, sortOrder: 6 },
        { name: 'แม่บ้านหัวหน้าโซน', nameEn: 'Zone Housekeeper', level: 5, sortOrder: 7 },
      ],
      FB: [
        { name: 'ผู้จัดการอาหารและเครื่องดื่ม', nameEn: 'F&B Manager', level: 8, sortOrder: 1 },
        { name: 'ผู้จัดการร้านอาหาร', nameEn: 'Restaurant Manager', level: 7, sortOrder: 2 },
        { name: 'พ่อครัวใหญ่', nameEn: 'Head Chef', level: 8, sortOrder: 3 },
        { name: 'พ่อครัวแต่ละส่วน', nameEn: 'Chef de Partie', level: 6, sortOrder: 4 },
        { name: 'พ่อครัวผู้ช่วย', nameEn: 'Commis Chef', level: 4, sortOrder: 5 },
        { name: 'บาริสต้า', nameEn: 'Barista', level: 4, sortOrder: 6 },
        { name: 'บาร์เทนเดอร์', nameEn: 'Bartender', level: 4, sortOrder: 7 },
        { name: 'พนักงานเสิร์ฟ', nameEn: 'Waiter / Waitress', level: 3, sortOrder: 8 },
        { name: 'แคชเชียร์ร้านอาหาร', nameEn: 'F&B Cashier', level: 3, sortOrder: 9 },
        { name: 'พนักงานรูมเซอร์วิส', nameEn: 'Room Service Attendant', level: 3, sortOrder: 10 },
      ],
      ENG: [
        { name: 'หัวหน้าวิศวกร', nameEn: 'Chief Engineer', level: 8, sortOrder: 1 },
        { name: 'ผู้ช่วยวิศวกร', nameEn: 'Assistant Engineer', level: 7, sortOrder: 2 },
        { name: 'ช่างไฟฟ้า', nameEn: 'Electrician', level: 5, sortOrder: 3 },
        { name: 'ช่างประปา', nameEn: 'Plumber', level: 5, sortOrder: 4 },
        { name: 'ช่างปรับอากาศ (HVAC)', nameEn: 'HVAC Technician', level: 5, sortOrder: 5 },
        { name: 'ช่างเทคนิคไอที', nameEn: 'IT Technician', level: 6, sortOrder: 6 },
        { name: 'ช่างทั่วไป', nameEn: 'General Maintenance', level: 3, sortOrder: 7 },
      ],
      HR: [
        { name: 'ผู้จัดการฝ่าย HR', nameEn: 'HR Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ HR', nameEn: 'HR Officer', level: 5, sortOrder: 2 },
        { name: 'เจ้าหน้าที่ฝึกอบรม', nameEn: 'Training Coordinator', level: 5, sortOrder: 3 },
        { name: 'เจ้าหน้าที่เงินเดือน', nameEn: 'Payroll Officer', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่สรรหาบุคลากร', nameEn: 'Recruitment Officer', level: 5, sortOrder: 5 },
      ],
      FIN: [
        { name: 'ผู้ควบคุมการเงิน', nameEn: 'Financial Controller', level: 9, sortOrder: 1 },
        { name: 'หัวหน้าบัญชี', nameEn: 'Chief Accountant', level: 8, sortOrder: 2 },
        { name: 'นักบัญชี', nameEn: 'Accountant', level: 6, sortOrder: 3 },
        { name: 'เจ้าหน้าที่จัดซื้อ', nameEn: 'Purchasing Officer', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่คลังสินค้า', nameEn: 'Store Keeper', level: 4, sortOrder: 5 },
      ],
      SM: [
        { name: 'ผู้จัดการฝ่ายขาย', nameEn: 'Sales Manager', level: 8, sortOrder: 1 },
        { name: 'เจ้าหน้าที่ขาย', nameEn: 'Sales Executive', level: 6, sortOrder: 2 },
        { name: 'เจ้าหน้าที่การตลาด', nameEn: 'Marketing Executive', level: 6, sortOrder: 3 },
        { name: 'เจ้าหน้าที่ประชาสัมพันธ์', nameEn: 'PR Coordinator', level: 5, sortOrder: 4 },
        { name: 'เจ้าหน้าที่ Revenue Management', nameEn: 'Revenue Manager', level: 7, sortOrder: 5 },
      ],
      SEC: [
        { name: 'ผู้จัดการรักษาความปลอดภัย', nameEn: 'Security Manager', level: 7, sortOrder: 1 },
        { name: 'หัวหน้าเวรรักษาความปลอดภัย', nameEn: 'Security Supervisor', level: 6, sortOrder: 2 },
        { name: 'พนักงานรักษาความปลอดภัย', nameEn: 'Security Officer', level: 3, sortOrder: 3 },
        { name: 'พนักงานควบคุม CCTV', nameEn: 'CCTV Operator', level: 4, sortOrder: 4 },
      ],
      SPA: [
        { name: 'ผู้จัดการสปา', nameEn: 'Spa Manager', level: 7, sortOrder: 1 },
        { name: 'นักบำบัด/นวดบำบัด', nameEn: 'Therapist', level: 5, sortOrder: 2 },
        { name: 'ผู้ฝึกสอนฟิตเนส', nameEn: 'Fitness Instructor', level: 5, sortOrder: 3 },
        { name: 'พนักงานต้อนรับสปา', nameEn: 'Spa Receptionist', level: 3, sortOrder: 4 },
        { name: 'พนักงานดูแลสระว่ายน้ำ', nameEn: 'Pool Attendant', level: 3, sortOrder: 5 },
      ],
      MGT: [
        { name: 'ผู้จัดการทั่วไป', nameEn: 'General Manager', level: 10, sortOrder: 1 },
        { name: 'ผู้จัดการโรงแรม (Resident)', nameEn: 'Resident Manager', level: 9, sortOrder: 2 },
        { name: 'ผู้อำนวยการฝ่าย', nameEn: 'Director of Operations', level: 9, sortOrder: 3 },
        { name: 'ผู้ช่วยผู้จัดการทั่วไป', nameEn: 'Assistant General Manager', level: 8, sortOrder: 4 },
      ],
    };
  }

  // ─── Seed Departments & Positions ────────────────────────────────────────

  private async seedDepartmentsAndPositions(tenantId: string): Promise<void> {
    const departmentTemplates = this.getDepartmentTemplates();
    const positionTemplates = this.getPositionTemplates();

    for (const deptTemplate of departmentTemplates) {
      try {
        const dept = await this.prisma.hrDepartment.upsert({
          where: { tenantId_code: { tenantId, code: deptTemplate.code } },
          update: {},
          create: {
            tenantId,
            name: deptTemplate.name,
            nameEn: deptTemplate.nameEn,
            code: deptTemplate.code,
            color: deptTemplate.color,
            description: deptTemplate.description,
            isActive: true,
            sortOrder: deptTemplate.sortOrder,
          },
        });

        const positionList = positionTemplates[deptTemplate.code] ?? [];
        for (const posTemplate of positionList) {
          const positionId = `${dept.id}-${posTemplate.nameEn.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
          await this.prisma.hrPosition.upsert({
            where: { id: positionId },
            update: {},
            create: {
              id: positionId,
              tenantId,
              departmentId: dept.id,
              name: posTemplate.name,
              nameEn: posTemplate.nameEn,
              level: posTemplate.level,
              isActive: true,
              sortOrder: posTemplate.sortOrder,
            },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to seed department ${deptTemplate.code} for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(`  Departments & positions seeded for tenant ${tenantId}`);
  }

  // ─── Seed Leave Types ────────────────────────────────────────────────────

  private async seedLeaveTypes(tenantId: string): Promise<void> {
    const templates = [
      { name: 'ลาพักร้อน', nameEn: 'Annual Leave', code: 'ANNUAL', maxDaysPerYear: 15, isPaid: true, requiresDoc: false, color: '#10B981', sortOrder: 1, description: 'ลาพักร้อนประจำปี' },
      { name: 'ลาป่วย', nameEn: 'Sick Leave', code: 'SICK', maxDaysPerYear: 30, isPaid: true, requiresDoc: false, color: '#EF4444', sortOrder: 2, description: 'ลาเนื่องจากเจ็บป่วย' },
      { name: 'ลากิจ', nameEn: 'Personal Leave', code: 'PERSONAL', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#F59E0B', sortOrder: 3, description: 'ลากิจส่วนตัว' },
      { name: 'ลาคลอด', nameEn: 'Maternity Leave', code: 'MATERNITY', maxDaysPerYear: 90, isPaid: true, requiresDoc: true, color: '#EC4899', sortOrder: 4, description: 'ลาคลอดบุตร (ตามกฎหมายแรงงาน)' },
      { name: 'ลาเพื่อดูแลภรรยาคลอด', nameEn: 'Paternity Leave', code: 'PATERNITY', maxDaysPerYear: 15, isPaid: true, requiresDoc: true, color: '#3B82F6', sortOrder: 5, description: 'ลาเพื่อดูแลภรรยาคลอด' },
      { name: 'ลาแต่งงาน', nameEn: 'Marriage Leave', code: 'MARRIAGE', maxDaysPerYear: 3, isPaid: true, requiresDoc: true, color: '#A78BFA', sortOrder: 6, description: 'ลาแต่งงาน' },
      { name: 'ลาไว้ทุกข์', nameEn: 'Bereavement Leave', code: 'BEREAVEMENT', maxDaysPerYear: 3, isPaid: true, requiresDoc: false, color: '#6B7280', sortOrder: 7, description: 'ลาไว้ทุกข์บุคคลในครอบครัว' },
      { name: 'ลาอบรม/สัมมนา', nameEn: 'Training Leave', code: 'TRAINING', maxDaysPerYear: null, isPaid: true, requiresDoc: false, color: '#06B6D4', sortOrder: 8, description: 'ลาเพื่อเข้ารับการอบรมหรือสัมมนา' },
      { name: 'ลาราชการทหาร', nameEn: 'Military Leave', code: 'MILITARY', maxDaysPerYear: 60, isPaid: true, requiresDoc: true, color: '#78716C', sortOrder: 9, description: 'ลาราชการทหาร (ตามกฎหมาย)' },
      { name: 'ลาไม่รับเงินเดือน', nameEn: 'Unpaid Leave', code: 'UNPAID', maxDaysPerYear: null, isPaid: false, requiresDoc: false, color: '#D1D5DB', sortOrder: 10, description: 'ลาโดยไม่รับเงินเดือน' },
    ];

    for (const lt of templates) {
      await this.prisma.hrLeaveType.upsert({
        where: { tenantId_code: { tenantId, code: lt.code } },
        update: {},
        create: { tenantId, ...lt },
      });
    }
  }

  // ─── Seed Shift Types ────────────────────────────────────────────────────

  private async seedShiftTypes(tenantId: string): Promise<void> {
    const templates = [
      { name: 'กะเช้า', nameEn: 'Morning Shift', code: 'MORNING', startTime: '07:00', endTime: '15:00', breakMinutes: 60, color: '#F59E0B', sortOrder: 1, description: 'กะทำงานช่วงเช้า 07:00-15:00 น.' },
      { name: 'กะบ่าย', nameEn: 'Afternoon Shift', code: 'AFTERNOON', startTime: '15:00', endTime: '23:00', breakMinutes: 60, color: '#8B5CF6', sortOrder: 2, description: 'กะทำงานช่วงบ่าย 15:00-23:00 น.' },
      { name: 'กะดึก', nameEn: 'Night Shift', code: 'NIGHT', startTime: '23:00', endTime: '07:00', breakMinutes: 60, color: '#1E40AF', sortOrder: 3, description: 'กะทำงานช่วงดึก 23:00-07:00 น.' },
      { name: 'เวลาทำการปกติ', nameEn: 'Office Hours', code: 'OFFICE', startTime: '09:00', endTime: '18:00', breakMinutes: 60, color: '#10B981', sortOrder: 4, description: 'เวลาทำการสำนักงาน 09:00-18:00 น.' },
      { name: 'กะแยก (Split Shift)', nameEn: 'Split Shift', code: 'SPLIT', startTime: '06:00', endTime: '22:00', breakMinutes: 240, color: '#EF4444', sortOrder: 5, description: 'ทำงานช่วงเช้า 06:00-10:00 และช่วงเย็น 18:00-22:00' },
      { name: 'ยืดหยุ่น', nameEn: 'Flexible Hours', code: 'FLEXIBLE', startTime: '08:00', endTime: '17:00', breakMinutes: 60, color: '#6B7280', sortOrder: 6, description: 'เวลาทำงานยืดหยุ่นตามตกลง' },
    ];

    for (const st of templates) {
      await this.prisma.hrShiftType.upsert({
        where: { tenantId_code: { tenantId, code: st.code } },
        update: {},
        create: { tenantId, ...st },
      });
    }
  }

  // ─── Seed Allowance Types ────────────────────────────────────────────────

  private async seedAllowanceTypes(tenantId: string): Promise<void> {
    const templates = [
      { name: 'เซอร์วิสชาร์จ', nameEn: 'Service Charge', code: 'SERVICE_CHARGE', isTaxable: true, sortOrder: 1, description: 'ค่าบริการแบ่งให้พนักงาน' },
      { name: 'ค่าอาหาร', nameEn: 'Meal Allowance', code: 'MEAL', isTaxable: false, sortOrder: 2, description: 'เบี้ยเลี้ยงค่าอาหาร' },
      { name: 'ค่าเดินทาง', nameEn: 'Transportation Allowance', code: 'TRANSPORT', isTaxable: false, sortOrder: 3, description: 'ค่าใช้จ่ายการเดินทาง' },
      { name: 'ค่าที่พัก', nameEn: 'Housing Allowance', code: 'HOUSING', isTaxable: true, sortOrder: 4, description: 'เบี้ยเลี้ยงที่พักอาศัย' },
      { name: 'ค่าโทรศัพท์', nameEn: 'Phone Allowance', code: 'PHONE', isTaxable: false, sortOrder: 5, description: 'ค่าใช้จ่ายโทรศัพท์' },
      { name: 'ค่าล่วงเวลา', nameEn: 'Overtime Pay', code: 'OVERTIME', isTaxable: true, sortOrder: 6, description: 'ค่าจ้างการทำงานล่วงเวลา' },
      { name: 'เบี้ยกะ', nameEn: 'Shift Allowance', code: 'SHIFT', isTaxable: false, sortOrder: 7, description: 'เบี้ยเลี้ยงสำหรับการทำงานกะ' },
      { name: 'โบนัสประจำปี', nameEn: 'Annual Bonus', code: 'BONUS', isTaxable: true, sortOrder: 8, description: 'โบนัสประจำปีตามผลประกอบการ' },
      { name: 'ค่าคอมมิชชั่น', nameEn: 'Commission', code: 'COMMISSION', isTaxable: true, sortOrder: 9, description: 'ค่าคอมมิชชั่นจากการขาย' },
    ];

    for (const at of templates) {
      await this.prisma.hrAllowanceType.upsert({
        where: { tenantId_code: { tenantId, code: at.code } },
        update: {},
        create: { tenantId, ...at, isActive: true },
      });
    }
  }

  // ─── Seed Deduction Types ────────────────────────────────────────────────

  private async seedDeductionTypes(tenantId: string): Promise<void> {
    const templates = [
      { name: 'ภาษีเงินได้บุคคลธรรมดา', nameEn: 'Personal Income Tax', code: 'INCOME_TAX', isRequired: true, sortOrder: 1, description: 'ภาษีเงินได้หัก ณ ที่จ่าย (ตามกฎหมาย)' },
      { name: 'ประกันสังคม', nameEn: 'Social Security', code: 'SOCIAL_SECURITY', isRequired: true, sortOrder: 2, description: 'เงินสมทบกองทุนประกันสังคม 5% (สูงสุด 750 บาท/เดือน)' },
      { name: 'กองทุนสำรองเลี้ยงชีพ', nameEn: 'Provident Fund', code: 'PROVIDENT_FUND', isRequired: false, sortOrder: 3, description: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ' },
      { name: 'เงินกู้พนักงาน', nameEn: 'Employee Loan', code: 'EMPLOYEE_LOAN', isRequired: false, sortOrder: 4, description: 'หักคืนเงินกู้จากโรงแรม' },
      { name: 'หักขาดงาน', nameEn: 'Absence Deduction', code: 'ABSENCE', isRequired: false, sortOrder: 5, description: 'หักเงินกรณีขาดงานโดยไม่มีเหตุ' },
      { name: 'หักมาสาย', nameEn: 'Late Deduction', code: 'LATE', isRequired: false, sortOrder: 6, description: 'หักเงินกรณีมาทำงานสาย' },
      { name: 'สหกรณ์ออมทรัพย์', nameEn: 'Cooperative Savings', code: 'COOPERATIVE', isRequired: false, sortOrder: 7, description: 'เงินสะสมสหกรณ์ออมทรัพย์พนักงาน' },
    ];

    for (const dt of templates) {
      await this.prisma.hrDeductionType.upsert({
        where: { tenantId_code: { tenantId, code: dt.code } },
        update: {},
        create: { tenantId, ...dt, isActive: true },
      });
    }
  }
}
