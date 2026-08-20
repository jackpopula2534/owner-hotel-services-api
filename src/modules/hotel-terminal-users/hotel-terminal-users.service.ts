import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { StaffService } from '../staff/staff.service';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import {
  CreateHotelTerminalUserDto,
  HOTEL_TERMINAL_ROLES,
  type HotelTerminalRole,
} from './dto/create-hotel-terminal-user.dto';
import { UpdateHotelTerminalUserDto } from './dto/update-hotel-terminal-user.dto';
import { ImportFromEmployeeDto } from './dto/import-from-employee.dto';
import { BulkImportFromEmployeesDto } from './dto/bulk-import-from-employees.dto';

export interface HotelTerminalUserResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
  hrEmployeeId: string | null;
  propertyId: string | null;
  propertyName: string | null;
  permissions: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

interface UserLike {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
  metadata: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

interface HotelTerminalMetadata {
  hrEmployeeId?: string | null;
  propertyId?: string | null;
  permissions?: string[];
}

/** Default permission matrix by role. */
const DEFAULT_ROLE_PERMISSIONS: Record<HotelTerminalRole, string[]> = {
  hotel_manager: [
    'property.view',
    'property.manage',
    'rooms.view',
    'rooms.manage',
    'frontdesk.view',
    'frontdesk.manage',
    'bookings.view',
    'bookings.manage',
    'guests.view',
    'guests.manage',
    'housekeeping.view',
    'housekeeping.manage',
    'maintenance.view',
    'maintenance.manage',
  ],
  front_desk: [
    'frontdesk.view',
    'frontdesk.manage',
    'bookings.view',
    'bookings.manage',
    'guests.view',
    'guests.manage',
    'rooms.view',
  ],
  housekeeper: ['housekeeping.view', 'housekeeping.manage', 'rooms.view'],
  maintenance: ['maintenance.view', 'maintenance.manage', 'rooms.view'],
};

@Injectable()
export class HotelTerminalUsersService {
  private readonly logger = new Logger(HotelTerminalUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly staffService: StaffService,
  ) {}

  private allowedSystemsFor(_role: HotelTerminalRole): string {
    // Hotel terminal users keep access to the main dashboard so admins can
    // promote them later without re-issuing credentials.
    return JSON.stringify(['main', 'hotel-terminal']);
  }

  private parseMetadata(raw: string | null): HotelTerminalMetadata {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as HotelTerminalMetadata;
      }
    } catch {
      // ignore — metadata is best-effort
    }
    return {};
  }

  private mergeMetadata(raw: string | null, patch: HotelTerminalMetadata): string {
    return JSON.stringify({ ...this.parseMetadata(raw), ...patch });
  }

  /**
   * ตำแหน่งบนทะเบียนพนักงานปฏิบัติการ ที่คู่กับ role ของบัญชี Hotel Terminal
   *
   * มีแค่สองตำแหน่งที่รับงานจริง — แม่บ้านกับช่าง ผู้จัดการ/พนักงานต้อนรับเป็นคน
   * "สั่งงาน" ไม่ใช่ "รับงาน" จึงไม่ต้องขึ้นทะเบียน
   */
  private rosterRoleFor(role: HotelTerminalRole): 'housekeeper' | 'technician' | null {
    if (role === 'housekeeper') return 'housekeeper';
    if (role === 'maintenance') return 'technician';
    return null;
  }

  /**
   * ทำให้บัญชีแม่บ้าน/ช่างที่เพิ่งสร้าง โผล่ในรายชื่อ "มอบหมายงาน" ทันที
   *
   * ก่อนหน้านี้หน้า "ผู้ใช้โรงแรม" เขียนลงตาราง users อย่างเดียว ส่วนหน้ามอบหมายงาน
   * แม่บ้านอ่านจากตาราง staff คนละใบ — สร้างบัญชีแม่บ้านเสร็จแล้วกลับไปมอบหมายงาน
   * ก็ยังขึ้นว่า "ยังไม่มีพนักงานในระบบ" ตอนนี้ทั้งสองหน้าอ่านทะเบียนเดียวกัน
   *
   * เป็นงานเสริม (best-effort) — ถ้าขึ้นทะเบียนไม่สำเร็จ บัญชีที่สร้างไปแล้วต้องไม่ล้ม
   * ตามไปด้วย แต่ต้องมี log ไว้ให้ตามได้
   */
  private async syncRoster(
    user: { firstName: string | null; lastName: string | null; email: string; phone?: string | null },
    role: HotelTerminalRole,
    tenantId: string,
    opts: { employeeCode?: string | null; hrEmployeeId?: string | null } = {},
  ): Promise<void> {
    const rosterRole = this.rosterRoleFor(role);
    if (!rosterRole) return;

    try {
      const { staff, action } = await this.staffService.provision(
        {
          firstName: user.firstName ?? user.email.split('@')[0],
          lastName: user.lastName ?? '',
          email: user.email,
          phone: user.phone ?? null,
          role: rosterRole,
          department: rosterRole === 'technician' ? 'maintenance' : 'housekeeping',
          employeeCode: opts.employeeCode ?? null,
          employeeId: opts.hrEmployeeId ?? null,
        },
        tenantId,
      );
      this.logger.log(
        `Roster sync (${action}): ${user.email} → staff ${staff.id} (${rosterRole}) tenant=${tenantId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Roster sync failed for ${user.email} (${rosterRole}) tenant=${tenantId}: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  /**
   * ย้ายตำแหน่งบนทะเบียนให้ตามบัญชี รวมถึงกรณี "เลิกรับงานแล้ว"
   *
   * เปลี่ยนแม่บ้าน → ช่าง แต่ทะเบียนยังเป็นแม่บ้าน = ใบงานซ่อมมองไม่เห็นคนคนนี้
   * ส่วนเปลี่ยนเป็นผู้จัดการ/พนักงานต้อนรับ (ไม่ลงมือทำงานห้องแล้ว) ต้องถอดออกจาก
   * รายชื่อมอบหมายงาน แต่ห้ามลบแถวทิ้ง เพราะงานเก่าที่เคยทำยังอ้างอิงอยู่ — ปิดใช้งานแทน
   *
   * provision() เป็นงาน "รับช่วงหรือสร้างใหม่" โดยไม่ทับข้อมูลเดิม การย้ายแผนกจึงต้อง
   * สั่งตรงนี้อีกชั้น
   */
  private async reconcileRosterRole(
    user: {
      firstName: string | null;
      lastName: string | null;
      email: string;
      phone?: string | null;
      status?: string | null;
    },
    role: HotelTerminalRole,
    tenantId: string,
    opts: { employeeCode?: string | null; hrEmployeeId?: string | null } = {},
  ): Promise<void> {
    const rosterRole = this.rosterRoleFor(role);
    if (!rosterRole) {
      await this.syncRosterStatus(user.email, 'inactive', tenantId);
      return;
    }

    await this.syncRoster(user, role, tenantId, opts);

    try {
      const staff = await this.prisma.staff.findFirst({
        where: { email: user.email, tenantId },
      });
      if (!staff) return;

      const data: Prisma.StaffUpdateInput = {};
      if (staff.role !== rosterRole) {
        data.role = rosterRole;
        data.department = rosterRole === 'technician' ? 'maintenance' : 'housekeeping';
      }
      // กลับมารับงานอีกครั้ง — แต่ "ลาพัก" เป็นสถานะที่หัวหน้าตั้งเอง ห้ามเขียนทับ
      if (staff.status === 'inactive' && (user.status ?? 'active') === 'active') {
        data.status = 'active';
      }
      if (Object.keys(data).length === 0) return;

      await this.prisma.staff.update({ where: { id: staff.id }, data });
      this.logger.log(
        `Roster role sync: staff ${staff.id} → ${rosterRole} (tenant=${tenantId})`,
      );
    } catch (error) {
      this.logger.warn(
        `Roster role sync failed for ${user.email} tenant=${tenantId}: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  /**
   * ปิด/เปิดการใช้งานบนทะเบียนพนักงานให้ตรงกับสถานะบัญชี
   *
   * บัญชีที่ถูกระงับแล้วยังโผล่ให้เลือกมอบหมายงานได้ = มอบงานให้คนที่ล็อกอินไม่ได้
   */
  private async syncRosterStatus(
    email: string,
    status: string,
    tenantId: string,
  ): Promise<void> {
    const rosterStatus = status === 'active' ? 'active' : 'inactive';
    try {
      const staff = await this.prisma.staff.findFirst({ where: { email, tenantId } });
      if (!staff || staff.status === rosterStatus || staff.status === 'on_leave') return;
      await this.prisma.staff.update({ where: { id: staff.id }, data: { status: rosterStatus } });
      this.logger.log(`Roster status sync: staff ${staff.id} → ${rosterStatus} (tenant=${tenantId})`);
    } catch (error) {
      this.logger.warn(
        `Roster status sync failed for ${email} tenant=${tenantId}: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  async create(
    dto: CreateHotelTerminalUserDto,
    tenantId: string,
  ): Promise<{ success: true; data: HotelTerminalUserResponse }> {
    const existing = await this.tenantContext.runUnscoped(() =>
      this.prisma.user.findFirst({ where: { email: dto.email } }),
    );
    if (existing) {
      throw new ConflictException(`A user with email "${dto.email}" already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const permissions = dto.permissions ?? DEFAULT_ROLE_PERMISSIONS[dto.role];
    const metadata: HotelTerminalMetadata = {
      hrEmployeeId: dto.hrEmployeeId ?? null,
      propertyId: dto.propertyId ?? null,
      permissions,
    };

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        role: dto.role,
        tenantId,
        employeeId: dto.employeeId ?? null,
        status: 'active',
        allowedSystems: this.allowedSystemsFor(dto.role),
        metadata: JSON.stringify(metadata),
      } as unknown as Prisma.UserCreateInput,
    });

    this.logger.log(
      `Hotel Terminal user created: ${user.email} (role=${user.role}, property=${dto.propertyId ?? '-'}) tenant=${tenantId}`,
    );

    // ถ้าเป็นแม่บ้าน/ช่าง ให้ขึ้นทะเบียนพนักงานปฏิบัติการด้วย จะได้มอบหมายงานได้เลย
    // hrEmployeeId ที่ผู้เรียกส่งมาต้องพิสูจน์ก่อนว่าเป็นพนักงานของ tenant นี้จริง
    const verifiedHrEmployeeId = dto.hrEmployeeId
      ? (await this.prisma.employee.findFirst({ where: { id: dto.hrEmployeeId, tenantId } }))?.id ?? null
      : null;
    await this.syncRoster(user as unknown as UserLike, dto.role, tenantId, {
      employeeCode: dto.employeeId ?? null,
      hrEmployeeId: verifiedHrEmployeeId,
    });

    return { success: true, data: await this.formatWithProperty(user as unknown as UserLike) };
  }

  async importFromEmployee(
    dto: ImportFromEmployeeDto,
    tenantId: string,
  ): Promise<{ success: true; data: HotelTerminalUserResponse }> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found or does not belong to your tenant');
    }

    if (await this.tenantContext.runUnscoped(() => this.prisma.user.findFirst({ where: { email: employee.email } }))) {
      throw new ConflictException(
        `A user with email "${employee.email}" already exists. Use the regular flow to update it.`,
      );
    }

    const propertyId = dto.propertyId ?? employee.propertyId ?? undefined;
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const permissions = DEFAULT_ROLE_PERMISSIONS[dto.role];
    const metadata: HotelTerminalMetadata = {
      hrEmployeeId: employee.id,
      propertyId: propertyId ?? null,
      permissions,
    };

    const user = await this.prisma.user.create({
      data: {
        email: employee.email,
        password: hashedPassword,
        firstName: employee.firstName,
        lastName: employee.lastName,
        role: dto.role,
        tenantId,
        employeeId: employee.employeeCode ?? null,
        status: 'active',
        allowedSystems: this.allowedSystemsFor(dto.role),
        metadata: JSON.stringify(metadata),
      } as unknown as Prisma.UserCreateInput,
    });

    this.logger.log(
      `Hotel Terminal user imported from HR employee ${employee.id}: ${user.email} (role=${user.role}) tenant=${tenantId}`,
    );

    await this.syncRoster(user as unknown as UserLike, dto.role, tenantId, {
      employeeCode: employee.employeeCode ?? null,
      hrEmployeeId: employee.id,
    });

    return { success: true, data: await this.formatWithProperty(user as unknown as UserLike) };
  }

  /**
   * Bulk-import multiple HR employees as hotel terminal users at once.
   * Skips employees that are already linked (or whose email is already a user)
   * and reports per-row success/failure so the UI can show a summary.
   */
  async bulkImportFromEmployees(
    dto: BulkImportFromEmployeesDto,
    tenantId: string,
  ): Promise<{
    success: true;
    data: {
      created: HotelTerminalUserResponse[];
      skipped: { employeeId: string; reason: string }[];
    };
  }> {
    const hashedPassword = await bcrypt.hash(dto.defaultPassword, 10);
    const created: HotelTerminalUserResponse[] = [];
    const skipped: { employeeId: string; reason: string }[] = [];

    for (const item of dto.items) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: item.employeeId, tenantId },
      });
      if (!employee) {
        skipped.push({ employeeId: item.employeeId, reason: 'ไม่พบในระบบ HR' });
        continue;
      }
      const existing = await this.tenantContext.runUnscoped(() =>
        this.prisma.user.findFirst({ where: { email: employee.email } }),
      );
      if (existing) {
        skipped.push({
          employeeId: item.employeeId,
          reason: `อีเมล ${employee.email} ถูกใช้ไปแล้ว`,
        });
        continue;
      }

      const propertyId = item.propertyId ?? employee.propertyId ?? null;
      const permissions = DEFAULT_ROLE_PERMISSIONS[item.role];
      const metadata: HotelTerminalMetadata = {
        hrEmployeeId: employee.id,
        propertyId,
        permissions,
      };

      try {
        const user = await this.prisma.user.create({
          data: {
            email: employee.email,
            password: hashedPassword,
            firstName: employee.firstName,
            lastName: employee.lastName,
            role: item.role,
            tenantId,
            employeeId: employee.employeeCode ?? null,
            status: 'active',
            allowedSystems: this.allowedSystemsFor(item.role),
            metadata: JSON.stringify(metadata),
          } as unknown as Prisma.UserCreateInput,
        });
        created.push(await this.formatWithProperty(user as unknown as UserLike));
        await this.syncRoster(user as unknown as UserLike, item.role, tenantId, {
          employeeCode: employee.employeeCode ?? null,
          hrEmployeeId: employee.id,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'สร้างไม่สำเร็จ';
        skipped.push({ employeeId: item.employeeId, reason: message });
      }
    }

    this.logger.log(
      `Bulk-imported ${created.length} hotel terminal users (skipped ${skipped.length}) tenant=${tenantId}`,
    );

    return {
      success: true,
      data: { created, skipped },
    };
  }

  async findAll(tenantId: string): Promise<{ success: true; data: HotelTerminalUserResponse[] }> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: HOTEL_TERMINAL_ROLES as unknown as string[] },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });
    return {
      success: true,
      data: await Promise.all(users.map((u) => this.formatWithProperty(u as unknown as UserLike))),
    };
  }

  async findOne(
    userId: string,
    tenantId: string,
  ): Promise<{ success: true; data: HotelTerminalUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('Hotel Terminal user not found');
    return {
      success: true,
      data: await this.formatWithProperty(user as unknown as UserLike),
    };
  }

  async update(
    userId: string,
    tenantId: string,
    dto: UpdateHotelTerminalUserDto,
  ): Promise<{ success: true; data: HotelTerminalUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new BadRequestException('User not found or does not belong to your tenant');
    }

    const data: Record<string, unknown> = {};
    if (dto.role) {
      data.role = dto.role;
      data.allowedSystems = this.allowedSystemsFor(dto.role);
    }
    if (dto.status) data.status = dto.status;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);

    if (dto.permissions !== undefined || dto.propertyId !== undefined) {
      const patch: HotelTerminalMetadata = {};
      if (dto.permissions !== undefined) patch.permissions = dto.permissions;
      if (dto.propertyId !== undefined) patch.propertyId = dto.propertyId;
      data.metadata = this.mergeMetadata((user as unknown as UserLike).metadata, patch);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: data as Prisma.UserUpdateInput,
    });

    // เปลี่ยนตำแหน่งเป็นแม่บ้าน/ช่าง → ต้องขึ้นทะเบียนให้ด้วย ไม่งั้นเลือกมอบหมายงานไม่ได้
    // เปลี่ยนออกจากสองตำแหน่งนี้ → ต้องถอดออกจากรายชื่อมอบหมายงานเช่นกัน
    if (dto.role) {
      await this.reconcileRosterRole(updated as unknown as UserLike, dto.role, tenantId, {
        employeeCode: (updated as unknown as UserLike).employeeId ?? null,
        hrEmployeeId: this.parseMetadata((updated as unknown as UserLike).metadata).hrEmployeeId ?? null,
      });
    }
    if (dto.status) {
      await this.syncRosterStatus(updated.email, dto.status, tenantId);
    }

    return {
      success: true,
      data: await this.formatWithProperty(updated as unknown as UserLike),
    };
  }

  async remove(userId: string, tenantId: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('Hotel Terminal user not found');

    // Soft-disable instead of hard delete (keeps audit trail / foreign keys).
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
    await this.syncRosterStatus(user.email, 'inactive', tenantId);
    return { success: true };
  }

  /**
   * ยกบัญชีแม่บ้าน/ช่างที่มีอยู่แล้ว ขึ้นทะเบียนพนักงานปฏิบัติการย้อนหลัง
   *
   * บัญชีที่ถูกสร้างก่อนที่การขึ้นทะเบียนอัตโนมัติจะมีผล ยังค้างอยู่ในตาราง users
   * อย่างเดียว — เจ้าของโรงแรมเห็นชื่อในหน้า "ผู้ใช้โรงแรม" ครบทุกคน แต่พอไป
   * มอบหมายงานกลับขึ้นว่า "ยังไม่มีพนักงานในระบบ" นี่คือทางแก้ที่ไม่ต้องพึ่ง
   * ส่วนเสริม HR เลย
   *
   * ทำซ้ำได้ — คนที่ขึ้นทะเบียนแล้วนับเป็น existing ไม่เกิดแถวซ้ำ
   */
  async syncRosterFromAccounts(tenantId: string): Promise<{
    success: true;
    data: { created: number; existing: number; skipped: number };
  }> {
    if (!tenantId) throw new BadRequestException('No active tenant');

    const accounts = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: ['housekeeper', 'maintenance'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    let created = 0;
    let existing = 0;
    let skipped = 0;

    for (const account of accounts) {
      // บัญชีที่ถูกระงับ ไม่ควรโผล่ให้เลือกมอบหมายงาน — ข้ามไป ไม่ต้องสร้างแถว
      if (account.status !== 'active') {
        skipped += 1;
        continue;
      }
      const user = account as unknown as UserLike;
      const rosterRole = this.rosterRoleFor(user.role as HotelTerminalRole);
      if (!rosterRole) {
        skipped += 1;
        continue;
      }

      try {
        const { action } = await this.staffService.provision(
          {
            firstName: user.firstName ?? user.email.split('@')[0],
            lastName: user.lastName ?? '',
            email: user.email,
            role: rosterRole,
            department: rosterRole === 'technician' ? 'maintenance' : 'housekeeping',
            employeeCode: user.employeeId ?? null,
            employeeId: this.parseMetadata(user.metadata).hrEmployeeId ?? null,
          },
          tenantId,
        );
        if (action === 'created') created += 1;
        else existing += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `Roster backfill skipped ${user.email} tenant=${tenantId}: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    this.logger.log(
      `Roster backfill for tenant ${tenantId}: created=${created} existing=${existing} skipped=${skipped}`,
    );
    return { success: true, data: { created, existing, skipped } };
  }

  /** Stats: totals, by-role, active-today, etc. */
  async stats(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: HOTEL_TERMINAL_ROLES as unknown as string[] },
      },
      select: { role: true, status: true, lastLoginAt: true },
    });
    const now = Date.now();
    const byRole: Record<string, number> = {};
    for (const role of HOTEL_TERMINAL_ROLES) byRole[role] = 0;

    let active = 0;
    let inactive = 0;
    let loggedInToday = 0;
    for (const u of users) {
      byRole[u.role] = (byRole[u.role] ?? 0) + 1;
      if (u.status === 'active') active += 1;
      else inactive += 1;
      if (u.lastLoginAt && now - u.lastLoginAt.getTime() < 86_400_000) {
        loggedInToday += 1;
      }
    }

    return {
      success: true,
      data: {
        total: users.length,
        active,
        inactive,
        loggedInToday,
        byRole,
      },
    };
  }

  /**
   * List employees (from HR module) that can be imported as hotel terminal users.
   *
   * Tenant resolution strategy:
   *   1. The caller's primary `tenantId` (from JWT) is queried first.
   *   2. If that returns no rows, every tenant the caller belongs to via the
   *      `UserTenant` junction is queried (covers the case where a user owns
   *      multiple properties / the JWT carries a stale tenantId after a tenant
   *      rebuild).
   *   3. As a last-resort safety net for single-tenant installs, if the global
   *      employee table has rows and the caller has access to exactly one HR
   *      tenant, that tenant is used.
   *
   * Filters out clearly-departed staff (terminated/resigned/inactive/deleted)
   * on the application side using a case-insensitive comparison — the HR
   * module stores `status` as "ACTIVE" or "Active" inconsistently and a
   * strict Prisma filter would silently drop legitimate rows.
   *
   * Linked users (regardless of role) are marked `alreadyLinked: true` so the
   * UI can disable them while still showing them.
   *
   * The response carries a `meta.diagnostic` field (only when no employees are
   * returned) that the frontend can surface to help admins debug seeding /
   * tenant-mapping issues without needing server logs.
   */
  async listImportableEmployees(
    callerOrTenantId:
      | string
      | {
          userId?: string;
          tenantId?: string;
          page?: number;
          limit?: number;
          search?: string;
          department?: string;
        },
  ) {
    // Backwards-compat: callers historically passed a bare tenantId string.
    const caller =
      typeof callerOrTenantId === 'string'
        ? { userId: undefined, tenantId: callerOrTenantId }
        : callerOrTenantId;
    const primaryTenantId = caller.tenantId ?? '';
    const page = Math.max(1, caller.page ?? 1);
    const limit = Math.min(200, Math.max(1, caller.limit ?? 20));
    const search = caller.search?.trim();
    const department = caller.department?.trim();

    if (!primaryTenantId) {
      this.logger.warn('[hotel-terminal] listImportableEmployees called without tenantId');
      return {
        success: true,
        data: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          diagnostic: {
            reason: 'no_tenant_in_token',
            primaryTenantId: null,
            globalEmployeeCount: null,
          },
        },
      };
    }

    // Build the WHERE filter shared by count + findMany. We do the status
    // filter at the application layer (kept from the original implementation)
    // because HR data has inconsistent casing — but for SEARCH we let MySQL
    // do the work so pagination works on the actual filtered result set.
    const buildWhere = (tenantId: string) => {
      const where: any = { tenantId };
      if (department) where.department = department;
      if (search) {
        where.OR = [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { email: { contains: search } },
          { employeeCode: { contains: search } },
          { position: { contains: search } },
        ];
      }
      return where;
    };

    const SELECT = {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employeeCode: true,
      department: true,
      position: true,
      propertyId: true,
      status: true,
    } as const;
    const ORDER_BY = [{ firstName: 'asc' as const }, { lastName: 'asc' as const }];

    // Step 1 — count + page from the primary tenant.
    let resolvedTenantId = primaryTenantId;
    let total = await this.prisma.employee.count({
      where: buildWhere(primaryTenantId),
    });

    // Step 2 — if no rows match in the primary tenant AND we are not under an
    // active filter (search/department empty), try the UserTenant fallback so
    // freshly-onboarded admins still see employees from a sibling tenant.
    if (total === 0 && !search && !department && caller.userId) {
      try {
        const memberships = await (this.prisma as any).userTenant.findMany({
          where: { userId: caller.userId },
          select: { tenantId: true },
        });
        const otherTenantIds = memberships
          .map((m: { tenantId: string }) => m.tenantId)
          .filter((id: string) => id && id !== primaryTenantId);

        if (otherTenantIds.length > 0) {
          const counts = (await this.prisma.$queryRawUnsafe(
            `SELECT tenantId, COUNT(*) AS cnt FROM employees
             WHERE tenantId IN (${otherTenantIds.map(() => '?').join(',')})
             GROUP BY tenantId
             ORDER BY cnt DESC LIMIT 1`,
            ...otherTenantIds,
          )) as Array<{ tenantId: string; cnt: number | bigint }>;

          if (counts.length > 0 && Number(counts[0].cnt) > 0) {
            resolvedTenantId = counts[0].tenantId;
            this.logger.warn(
              `[hotel-terminal] No employees for primary tenant=${primaryTenantId}. ` +
                `Falling back to UserTenant member tenant=${resolvedTenantId}.`,
            );
            total = await this.prisma.employee.count({
              where: buildWhere(resolvedTenantId),
            });
          }
        }
      } catch (err) {
        this.logger.error(
          `[hotel-terminal] UserTenant fallback failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Step 3 — page the actual rows from the resolved tenant.
    const employees = total
      ? await this.prisma.employee.findMany({
          where: buildWhere(resolvedTenantId),
          select: SELECT,
          orderBy: ORDER_BY,
          skip: (page - 1) * limit,
          take: limit,
        })
      : [];

    // Step 4 — application-side status filter (case-insensitive). Note this
    // means the *page* may show fewer rows than `limit` if some on the page
    // are terminated; the count we surface (`total`) is the pre-filter count
    // since per-page filtering is the safer trade-off (vs running TWO counts).
    const HIDDEN_STATUSES = new Set(['terminated', 'resigned', 'inactive', 'deleted']);
    const filtered = employees.filter((e) => {
      const s = (e.status ?? '').toLowerCase().trim();
      return !HIDDEN_STATUSES.has(s);
    });

    this.logger.log(
      `[hotel-terminal] page=${page} limit=${limit} total=${total} ` +
        `returned=${filtered.length} (resolvedTenant=${resolvedTenantId})`,
    );

    // Mark employees already linked to a user account so the UI can disable
    // them. We scope by the resolved tenant so the link check matches the
    // data we actually returned.
    const emails = filtered.map((e) => e.email).filter(Boolean);
    const existingUsers = emails.length
      ? await this.prisma.user.findMany({
          where: {
            tenantId: resolvedTenantId,
            email: { in: emails },
          },
          select: { email: true, role: true },
        })
      : [];
    const linkedEmails = new Set(existingUsers.map((u) => u.email));

    const data = filtered.map((e) => ({
      id: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      employeeCode: e.employeeCode,
      department: e.department,
      position: e.position,
      propertyId: e.propertyId,
      alreadyLinked: linkedEmails.has(e.email),
    }));

    const totalPages = Math.max(1, Math.ceil(total / limit));

    // Diagnostic envelope: only attached when the response is empty AND the
    // user is on page 1 with no filters (so we don't spam the diagnostic
    // probe on every paginated request).
    let diagnostic = undefined;
    if (data.length === 0 && page === 1 && !search && !department) {
      let globalEmployeeCount: number | null = null;
      let tenantsWithEmployees: Array<{ tenantId: string; count: number }> = [];
      try {
        globalEmployeeCount = await this.prisma.employee.count();
        const rows = (await this.prisma.$queryRawUnsafe(
          `SELECT tenantId, COUNT(*) AS cnt FROM employees
           WHERE tenantId IS NOT NULL GROUP BY tenantId ORDER BY cnt DESC LIMIT 5`,
        )) as Array<{ tenantId: string; cnt: number | bigint }>;
        tenantsWithEmployees = rows.map((r) => ({
          tenantId: r.tenantId,
          count: Number(r.cnt),
        }));
      } catch (err) {
        this.logger.error(
          `[hotel-terminal] Diagnostic probe failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      diagnostic = {
        reason: globalEmployeeCount === 0 ? 'no_employees_in_database' : 'no_employees_for_tenant',
        primaryTenantId,
        resolvedTenantId,
        globalEmployeeCount,
        tenantsWithEmployees,
        statusFilteredOut: employees.length - filtered.length,
      };
    }

    return {
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        ...(diagnostic ? { diagnostic } : {}),
      },
    };
  }

  /**
   * List unique department names that exist for HR employees in the caller's
   * tenant. Used to populate the department filter dropdown without forcing
   * the client to load all employees first.
   */
  async listImportableEmployeeDepartments(caller: {
    userId?: string;
    tenantId: string;
  }): Promise<{ success: true; data: string[] }> {
    if (!caller.tenantId) return { success: true, data: [] };

    // Pick the same tenant as listImportableEmployees would (primary first,
    // fallback to a UserTenant sibling when the primary has no rows).
    let resolvedTenantId = caller.tenantId;
    const primaryCount = await this.prisma.employee.count({
      where: { tenantId: resolvedTenantId },
    });
    if (primaryCount === 0 && caller.userId) {
      const memberships = await (this.prisma as any).userTenant.findMany({
        where: { userId: caller.userId },
        select: { tenantId: true },
      });
      const otherTenantIds = memberships
        .map((m: { tenantId: string }) => m.tenantId)
        .filter((id: string) => id && id !== caller.tenantId);
      if (otherTenantIds.length > 0) {
        const counts = (await this.prisma.$queryRawUnsafe(
          `SELECT tenantId, COUNT(*) AS cnt FROM employees
           WHERE tenantId IN (${otherTenantIds.map(() => '?').join(',')})
           GROUP BY tenantId ORDER BY cnt DESC LIMIT 1`,
          ...otherTenantIds,
        )) as Array<{ tenantId: string; cnt: number | bigint }>;
        if (counts.length > 0 && Number(counts[0].cnt) > 0) {
          resolvedTenantId = counts[0].tenantId;
        }
      }
    }

    const rows = await this.prisma.employee.findMany({
      where: { tenantId: resolvedTenantId, department: { not: null } },
      select: { department: true },
      distinct: ['department'],
      orderBy: { department: 'asc' },
    });
    return {
      success: true,
      data: rows.map((r) => r.department).filter((d): d is string => !!d && d.trim().length > 0),
    };
  }

  /** Serialize user + property name. */
  private async formatWithProperty(user: UserLike): Promise<HotelTerminalUserResponse> {
    const meta = this.parseMetadata(user.metadata);
    let propertyName: string | null = null;
    if (meta.propertyId) {
      const property = await this.prisma.property.findFirst({
        where: { id: meta.propertyId },
        select: { name: true },
      });
      propertyName = property?.name ?? null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      employeeId: user.employeeId,
      hrEmployeeId: meta.hrEmployeeId ?? null,
      propertyId: meta.propertyId ?? null,
      propertyName,
      permissions: Array.isArray(meta.permissions) ? meta.permissions : [],
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
