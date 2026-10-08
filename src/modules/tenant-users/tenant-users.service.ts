/**
 * tenant-users — จุดเดียวสำหรับจัดการ "ใครเข้าระบบไหนได้ในบทบาทอะไร" ของ tenant
 *
 * แหล่งความจริงคือตาราง `user_terminal_access` (หนึ่งแถวต่อ user × terminal)
 * แต่ระบบยังมีบัญชีเก่าที่ยังไม่ได้ backfill — service นี้จึง **อ่านทะลุ** (read-through):
 * ถ้าบัญชีไม่มีแถวสิทธิ์เลย จะประกอบสิทธิ์จาก `allowedSystems` + `users.role` +
 * blob สิทธิ์เดิม (metadata.permissions / procurementPermissions / warehousePermissions)
 * ให้เอง API จึงใช้ได้ก่อนรันสคริปต์ backfill
 *
 * ทุกครั้งที่เขียนสิทธิ์ ต้อง sync กลับไปที่ `users.allowedSystems` (SystemGuard และ
 * auth.service ยังอ่านฟิลด์นั้นตอน login) และเขียนคอลัมน์สิทธิ์เดิมให้ตรงเท่าที่ทำได้ถูก
 * เพื่อให้ terminal ที่ deploy แล้วยังทำงานได้เหมือนเดิม
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import type { User, UserTerminalAccess } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditCategory, AuditResource } from '../../audit-log/dto/audit-log.dto';
import { AddonService } from '../addons/addon.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

import {
  ADMIN_LIKE_ROLES,
  OWNER_ROLES,
  MANAGER_LEVEL_ROLES,
  TERMINAL_KEYS,
  TERMINAL_REGISTRY,
  defaultPermissionsFor,
  getTerminal,
  isRoleOfTerminal,
  isTerminalKey,
  type TerminalKey,
} from './terminal-registry';
import type {
  ActorContext,
  AuditEntry,
  TenantUser,
  TenantUserStats,
  TerminalGrant,
  TerminalInfo,
} from './tenant-users.types';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TerminalGrantDto } from './dto/terminal-grant.dto';
import { BulkAccessDto } from './dto/bulk-access.dto';
import { ImportEmployeesDto } from './dto/import-employees.dto';
import {
  ImportableEmployeesQueryDto,
  ListTenantUsersQueryDto,
  USER_STATUSES,
  type UserStatus,
} from './dto/list-tenant-users-query.dto';

type Ok<T> = { success: true; data: T };

interface UserMetadata {
  hrEmployeeId?: string | null;
  propertyId?: string | null;
  permissions?: string[];
  [key: string]: unknown;
}

/** สิทธิ์ที่ตรวจแล้วพร้อมเขียน (role ถูกต้องตาม registry, permissions resolve แล้ว) */
interface NormalizedGrant {
  terminal: TerminalKey;
  role: string;
  /** null = ใช้ default ของ role (ไม่เก็บ override) */
  permissions: string[] | null;
  approvalLimit: number | null;
  scopeIds: string[] | null;
}

interface EmployeeLite {
  id: string;
  employeeCode: string | null;
  position: string | null;
  department: string | null;
}

/** บัญชีระดับแพลตฟอร์มไม่ใช่ที่นั่งของ tenant */
const PLATFORM_ROLES = new Set(['platform_admin']);

const DAY_MS = 86_400_000;

@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly auditLog: AuditLogService,
    private readonly addonService: AddonService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Reads
  // ═══════════════════════════════════════════════════════════════════════════

  async list(
    tenantId: string,
    query: ListTenantUsersQueryDto,
  ): Promise<{ success: true; data: TenantUser[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 25));

    let users = await this.loadTenantUsers(tenantId);

    const q = query.q?.trim().toLowerCase();
    if (q) {
      users = users.filter((u) =>
        [u.email, u.firstName, u.lastName, u.fullName, u.employeeCode]
          .filter((v): v is string => !!v)
          .some((v) => v.toLowerCase().includes(q)),
      );
    }
    if (query.status) users = users.filter((u) => u.status === query.status);
    if (query.terminal) {
      users = users.filter((u) => u.grants.some((g) => g.terminal === query.terminal));
    }
    if (query.role) {
      users = users.filter(
        (u) => u.primaryRole === query.role || u.grants.some((g) => g.role === query.role),
      );
    }

    const total = users.length;
    const start = (page - 1) * limit;
    return { success: true, data: users.slice(start, start + limit), total, page, limit };
  }

  async findOne(id: string, tenantId: string): Promise<Ok<TenantUser>> {
    return { success: true, data: await this.loadOne(id, tenantId) };
  }

  async stats(tenantId: string): Promise<Ok<TenantUserStats>> {
    const users = await this.loadTenantUsers(tenantId);
    const now = Date.now();
    const cutoff90d = now - 90 * DAY_MS;
    const soon = now + 7 * DAY_MS;

    const byTerminal = Object.fromEntries(TERMINAL_KEYS.map((k) => [k, 0])) as Record<
      TerminalKey,
      number
    >;
    const byStatus = Object.fromEntries(USER_STATUSES.map((s) => [s, 0])) as Record<
      UserStatus,
      number
    >;

    let seatsUsed = 0;
    let neverLoggedIn = 0;
    let inactive90d = 0;
    let expiringSoon = 0;
    let without2fa = 0;

    for (const u of users) {
      byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
      if (u.status === 'inactive') continue;

      for (const g of u.grants) byTerminal[g.terminal] += 1;
      if (u.status === 'active') {
        if (!PLATFORM_ROLES.has(u.primaryRole)) seatsUsed += 1;
        if (!u.twoFactorEnabled) without2fa += 1;
      }
      if (!u.lastLoginAt) neverLoggedIn += 1;
      else if (new Date(u.lastLoginAt).getTime() < cutoff90d) inactive90d += 1;
      if (u.expiresAt) {
        const t = new Date(u.expiresAt).getTime();
        if (t >= now && t <= soon) expiringSoon += 1;
      }
    }

    return {
      success: true,
      data: {
        seatsUsed,
        maxUsers: await this.maxUsersFor(tenantId),
        byTerminal,
        byStatus,
        neverLoggedIn,
        inactive90d,
        expiringSoon,
        without2fa,
      },
    };
  }

  async terminals(tenantId: string): Promise<Ok<TerminalInfo[]>> {
    const users = await this.loadTenantUsers(tenantId);
    return { success: true, data: await this.buildTerminalInfos(tenantId, users) };
  }

  async matrix(tenantId: string): Promise<Ok<{ terminals: TerminalInfo[]; users: TenantUser[] }>> {
    const users = await this.loadTenantUsers(tenantId);
    const terminals = await this.buildTerminalInfos(tenantId, users);
    return { success: true, data: { terminals, users } };
  }

  async audit(tenantId: string, limit = 50, targetUserId?: string): Promise<Ok<AuditEntry[]>> {
    const take = Math.min(500, Math.max(1, limit));
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId,
        resource: AuditResource.USER,
        ...(targetUserId ? { resourceId: targetUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        createdAt: true,
        userId: true,
        action: true,
        description: true,
        resourceId: true,
        ipAddress: true,
      },
    });

    const actorIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.tenantContext.runUnscoped(
          async () =>
            await this.prisma.user.findMany({
              where: { id: { in: actorIds } },
              select: { id: true, email: true },
            }),
        )
      : [];
    const emailById = new Map(actors.map((a) => [a.id, a.email]));

    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorEmail: r.userId ? (emailById.get(r.userId) ?? null) : null,
        action: r.action,
        description: r.description ?? null,
        targetUserId: r.resourceId ?? null,
        ipAddress: r.ipAddress ?? null,
      })),
    };
  }

  /** พนักงานจาก HR ที่ยังไม่มีบัญชีผู้ใช้ (generic ของ hotel-terminal-users) */
  async importableEmployees(tenantId: string, query: ImportableEmployeesQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 20));
    const q = query.q?.trim();
    const department = query.department?.trim();

    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (department) where.department = department;
    if (q) {
      where.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { email: { contains: q } },
        { employeeCode: { contains: q } },
        { position: { contains: q } },
      ];
    }

    const [total, employees] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          employeeCode: true,
          department: true,
          position: true,
          propertyId: true,
          status: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // HR เก็บ status ปนตัวพิมพ์ (ACTIVE / Active) — กรองฝั่งแอปแบบไม่สนตัวพิมพ์
    const HIDDEN = new Set(['terminated', 'resigned', 'inactive', 'deleted']);
    const visible = employees.filter((e) => !HIDDEN.has((e.status ?? '').toLowerCase().trim()));

    const emails = visible.map((e) => e.email).filter(Boolean);
    const linked = emails.length
      ? await this.tenantContext.runUnscoped(
          async () =>
            await this.prisma.user.findMany({
              where: { email: { in: emails } },
              select: { email: true },
            }),
        )
      : [];
    const linkedEmails = new Set(linked.map((u) => u.email));

    return {
      success: true,
      data: visible.map((e) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        employeeCode: e.employeeCode,
        department: e.department,
        position: e.position,
        propertyId: e.propertyId,
        alreadyLinked: linkedEmails.has(e.email),
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Writes
  // ═══════════════════════════════════════════════════════════════════════════

  async create(
    dto: CreateTenantUserDto,
    actor: ActorContext,
  ): Promise<Ok<TenantUser & { temporaryPassword?: string }>> {
    const tenantId = actor.tenantId;
    const email = dto.email.trim().toLowerCase();
    const grants = this.normalizeGrants(dto.grants);

    if (!dto.password && !dto.generatePassword) {
      throw new BadRequestException('ต้องระบุ password หรือส่ง generatePassword=true');
    }

    const existing = await this.tenantContext.runUnscoped(
      async () => await this.prisma.user.findFirst({ where: { email }, select: { id: true } }),
    );
    if (existing) throw new ConflictException(`A user with email "${email}" already exists`);

    await this.assertSeatAvailable(tenantId);

    const hrEmployee = dto.hrEmployeeId
      ? await this.prisma.employee.findFirst({
          where: { id: dto.hrEmployeeId, tenantId },
          select: { id: true, employeeCode: true },
        })
      : null;
    if (dto.hrEmployeeId && !hrEmployee) {
      throw new NotFoundException('Employee not found or does not belong to your tenant');
    }

    const temporaryPassword = dto.generatePassword ? this.generatePassword() : undefined;
    const hashed = await bcrypt.hash(temporaryPassword ?? dto.password!, 10);

    const created = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        phone: dto.phone ?? null,
        role: grants[0].role,
        tenantId,
        status: 'active',
        employeeId: dto.employeeCode ?? hrEmployee?.employeeCode ?? null,
        allowedSystems: JSON.stringify([]),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        metadata: JSON.stringify({ hrEmployeeId: hrEmployee?.id ?? null }),
      },
    });

    await this.writeGrants(created, grants, actor, 'replace', { silent: true });

    await this.record(actor, AuditAction.TENANT_USER_CREATE, created.id, {
      description: `สร้างบัญชี ${email} (${grants.map((g) => `${g.terminal}:${g.role}`).join(', ')})`,
      newValues: { email, grants: grants.map((g) => ({ terminal: g.terminal, role: g.role })) },
    });

    this.logger.log(
      `Tenant user created: ${email} terminals=${grants.map((g) => g.terminal).join(',')} tenant=${tenantId}`,
    );

    const data = await this.loadOne(created.id, tenantId);
    return {
      success: true,
      data: temporaryPassword ? { ...data, temporaryPassword } : data,
    };
  }

  async importEmployees(
    dto: ImportEmployeesDto,
    actor: ActorContext,
  ): Promise<Ok<{ created: TenantUser[]; skipped: { hrEmployeeId: string; reason: string }[] }>> {
    const tenantId = actor.tenantId;
    const hashed = await bcrypt.hash(dto.defaultPassword, 10);
    const created: TenantUser[] = [];
    const skipped: { hrEmployeeId: string; reason: string }[] = [];

    for (const item of dto.items) {
      let grants: NormalizedGrant[];
      try {
        grants = this.normalizeGrants(item.grants);
      } catch (err) {
        skipped.push({ hrEmployeeId: item.hrEmployeeId, reason: this.errorMessage(err) });
        continue;
      }

      const employee = await this.prisma.employee.findFirst({
        where: { id: item.hrEmployeeId, tenantId },
      });
      if (!employee) {
        skipped.push({ hrEmployeeId: item.hrEmployeeId, reason: 'ไม่พบในระบบ HR' });
        continue;
      }
      const email = (employee.email ?? '').trim().toLowerCase();
      if (!email) {
        skipped.push({ hrEmployeeId: item.hrEmployeeId, reason: 'พนักงานไม่มีอีเมล' });
        continue;
      }
      const existing = await this.tenantContext.runUnscoped(
        async () => await this.prisma.user.findFirst({ where: { email }, select: { id: true } }),
      );
      if (existing) {
        skipped.push({ hrEmployeeId: item.hrEmployeeId, reason: `อีเมล ${email} ถูกใช้ไปแล้ว` });
        continue;
      }

      try {
        await this.assertSeatAvailable(tenantId);
        const user = await this.prisma.user.create({
          data: {
            email,
            password: hashed,
            firstName: employee.firstName,
            lastName: employee.lastName,
            phone: employee.phone ?? null,
            role: grants[0].role,
            tenantId,
            status: 'active',
            employeeId: employee.employeeCode ?? null,
            allowedSystems: JSON.stringify([]),
            metadata: JSON.stringify({
              hrEmployeeId: employee.id,
              propertyId: employee.propertyId ?? null,
            }),
          },
        });
        await this.writeGrants(user, grants, actor, 'replace', { silent: true });
        await this.record(actor, AuditAction.TENANT_USER_IMPORT, user.id, {
          description: `นำเข้าพนักงาน ${email} จาก HR (${grants.map((g) => g.terminal).join(', ')})`,
          newValues: {
            hrEmployeeId: employee.id,
            grants: grants.map((g) => ({ terminal: g.terminal, role: g.role })),
          },
        });
        created.push(await this.loadOne(user.id, tenantId));
      } catch (err) {
        skipped.push({ hrEmployeeId: item.hrEmployeeId, reason: this.errorMessage(err) });
      }
    }

    this.logger.log(
      `Imported ${created.length} users from HR (skipped ${skipped.length}) tenant=${tenantId}`,
    );
    return { success: true, data: { created, skipped } };
  }

  async update(id: string, dto: UpdateTenantUserDto, actor: ActorContext): Promise<Ok<TenantUser>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);

    const data: Prisma.UserUpdateInput = {};
    const changed: Record<string, unknown> = {};
    if (dto.firstName !== undefined) changed.firstName = data.firstName = dto.firstName;
    if (dto.lastName !== undefined) changed.lastName = data.lastName = dto.lastName;
    if (dto.phone !== undefined) changed.phone = data.phone = dto.phone;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      changed.expiresAt = dto.expiresAt;
    }
    if (dto.password) {
      if (this.isOwner(user) && user.id !== actor.userId) {
        throw new ForbiddenException('ตั้งรหัสผ่านให้บัญชีเจ้าของผ่าน API นี้ไม่ได้');
      }
      data.password = await bcrypt.hash(dto.password, 10);
      changed.password = '***';
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data });
      await this.record(actor, AuditAction.TENANT_USER_UPDATE, user.id, {
        description: `แก้ไขข้อมูลผู้ใช้ ${user.email}`,
        newValues: changed,
      });
    }
    return { success: true, data: await this.loadOne(user.id, actor.tenantId) };
  }

  /** แทนที่สิทธิ์ทั้งชุด */
  async replaceAccess(
    id: string,
    grantDtos: TerminalGrantDto[],
    actor: ActorContext,
  ): Promise<Ok<TenantUser>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);
    this.assertEditable(user, actor);
    const grants = this.normalizeGrants(grantDtos);
    await this.writeGrants(user, grants, actor, 'replace');
    return { success: true, data: await this.loadOne(user.id, actor.tenantId) };
  }

  async bulkAccess(dto: BulkAccessDto, actor: ActorContext): Promise<Ok<{ updated: number }>> {
    if (!dto.grant && !dto.revoke) {
      throw new BadRequestException('ต้องระบุ grant หรือ revoke อย่างน้อยหนึ่งอย่าง');
    }
    const grant = dto.grant ? this.normalizeGrants([dto.grant])[0] : null;
    const ids = [...new Set(dto.userIds)];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, tenantId: actor.tenantId },
    });

    let updated = 0;
    for (const user of users) {
      // เจ้าของและตัวผู้เรียกเอง: ข้าม ไม่ล้มทั้งชุด
      if (this.isOwner(user) || user.id === actor.userId) continue;

      const current = await this.currentGrants(user);
      let next = current.map((g) => ({
        terminal: g.terminal,
        role: g.role,
        permissions: g.permissionsOverride,
        approvalLimit: g.approvalLimit ?? null,
        scopeIds: g.scopeIds ?? null,
      }));
      if (dto.revoke) next = next.filter((g) => g.terminal !== dto.revoke);
      if (grant) next = [...next.filter((g) => g.terminal !== grant.terminal), grant];

      await this.writeGrants(user, next, actor, 'replace');
      updated += 1;
    }
    return { success: true, data: { updated } };
  }

  async suspend(id: string, reason: string, actor: ActorContext): Promise<Ok<TenantUser>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);
    this.assertEditable(user, actor);
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException('ต้องระบุเหตุผลในการระงับ');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedBy: actor.userId,
        suspendedReason: trimmed,
      },
    });
    await this.record(actor, AuditAction.TENANT_USER_SUSPEND, user.id, {
      description: `ระงับผู้ใช้ ${user.email}: ${trimmed}`,
      oldValues: { status: user.status },
      newValues: { status: 'suspended', reason: trimmed },
    });
    return { success: true, data: await this.loadOne(user.id, actor.tenantId) };
  }

  async activate(id: string, actor: ActorContext): Promise<Ok<TenantUser>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'active',
        suspendedAt: null,
        suspendedBy: null,
        suspendedReason: null,
        deactivatedAt: null,
      },
    });
    await this.record(actor, AuditAction.TENANT_USER_ACTIVATE, user.id, {
      description: `เปิดใช้งานผู้ใช้ ${user.email}`,
      oldValues: { status: user.status },
      newValues: { status: 'active' },
    });
    return { success: true, data: await this.loadOne(user.id, actor.tenantId) };
  }

  async resetPassword(
    id: string,
    password: string | undefined,
    actor: ActorContext,
  ): Promise<Ok<{ temporaryPassword?: string }>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);
    if (this.isOwner(user) && user.id !== actor.userId) {
      throw new ForbiddenException('รีเซ็ตรหัสผ่านบัญชีเจ้าของผ่าน API นี้ไม่ได้');
    }
    const temporaryPassword = password ? undefined : this.generatePassword();
    const hashed = await bcrypt.hash(password ?? temporaryPassword!, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    await this.record(actor, AuditAction.TENANT_USER_PASSWORD_RESET, user.id, {
      description: `รีเซ็ตรหัสผ่านผู้ใช้ ${user.email}`,
    });
    return { success: true, data: temporaryPassword ? { temporaryPassword } : {} };
  }

  /** ลบแบบ soft — บัญชีผูกกับ Booking/Order/AuditLog จึงห้ามลบจริง */
  async remove(id: string, actor: ActorContext): Promise<Ok<{ id: string; status: 'inactive' }>> {
    const user = await this.findUserOrThrow(id, actor.tenantId);
    this.assertEditable(user, actor);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'inactive', deactivatedAt: new Date() },
    });
    await this.record(actor, AuditAction.TENANT_USER_DELETE, user.id, {
      description: `ปิดบัญชีผู้ใช้ ${user.email}`,
      oldValues: { status: user.status },
      newValues: { status: 'inactive' },
    });
    return { success: true, data: { id: user.id, status: 'inactive' } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Grants — read-through + write-back
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * สิทธิ์ปัจจุบันของบัญชี: จากตาราง `user_terminal_access` ถ้ามี ไม่งั้นประกอบจาก
   * ฟิลด์เดิม (allowedSystems + role + blob สิทธิ์) — ทำให้ API ใช้ได้ก่อน backfill
   */
  resolveGrants(user: User, rows: UserTerminalAccess[]): ResolvedGrant[] {
    const active = rows.filter((r) => !r.revokedAt && isTerminalKey(r.terminal));
    if (active.length > 0) {
      return active.map((r) => {
        const override = this.jsonStringArray(r.permissions);
        return {
          terminal: r.terminal as TerminalKey,
          role: r.role,
          permissions: override ?? defaultPermissionsFor(r.terminal, r.role),
          permissionsOverride: override,
          approvalLimit: r.approvalLimit === null ? null : Number(r.approvalLimit),
          scopeIds: this.jsonStringArray(r.scopeIds),
          grantedAt: r.grantedAt.toISOString(),
          grantedBy: r.grantedBy ?? null,
        };
      });
    }
    return this.deriveLegacyGrants(user);
  }

  /** ประกอบสิทธิ์จากฟิลด์เดิมของ users (ใช้กับบัญชีที่ยังไม่ได้ backfill) */
  deriveLegacyGrants(user: User): ResolvedGrant[] {
    const systems = this.parseStringArray(user.allowedSystems);
    const meta = this.parseMetadata(user.metadata);
    const grants: ResolvedGrant[] = [];

    for (const key of systems) {
      if (key === 'main' || !isTerminalKey(key)) continue;
      const def = TERMINAL_REGISTRY[key];
      const role = isRoleOfTerminal(key, user.role) ? user.role : def.roles[0]?.value;
      if (!role) continue;

      let override: string[] | null = null;
      let approvalLimit: number | null = null;
      let scopeIds: string[] | null = null;

      switch (key) {
        case 'hotel-terminal':
          override = Array.isArray(meta.permissions) ? meta.permissions : null;
          break;
        case 'procurement':
          override = this.parseStringArrayOrNull(user.procurementPermissions);
          approvalLimit = user.approvalLimit === null ? null : Number(user.approvalLimit);
          break;
        case 'warehouse':
          override = this.parseStringArrayOrNull(user.warehousePermissions);
          scopeIds = this.parseStringArrayOrNull(user.warehouseIds);
          break;
        case 'accounting':
        case 'hr':
          // สองโมดูลนี้ยืมคอลัมน์ warehousePermissions — เชื่อได้เฉพาะเมื่อ role หลักเป็นของมัน
          override = isRoleOfTerminal(key, user.role)
            ? this.parseStringArrayOrNull(user.warehousePermissions)
            : null;
          break;
        default:
          break;
      }

      grants.push({
        terminal: key,
        role,
        permissions: override ?? defaultPermissionsFor(key, role),
        permissionsOverride: override,
        approvalLimit,
        scopeIds,
        grantedAt: user.createdAt.toISOString(),
        grantedBy: null,
      });
    }
    return grants;
  }

  /** ตรวจ + ทำให้เป็นมาตรฐาน: terminal รู้จัก, role อยู่ในรายการของ terminal, ซ้ำ terminal = ตัวหลังชนะ */
  normalizeGrants(input: TerminalGrantDto[] | NormalizedGrant[]): NormalizedGrant[] {
    const byTerminal = new Map<TerminalKey, NormalizedGrant>();
    for (const g of input ?? []) {
      const def = getTerminal(g.terminal);
      if (!def) throw new BadRequestException(`ไม่รู้จักระบบ "${g.terminal}"`);
      if (!isRoleOfTerminal(g.terminal, g.role)) {
        throw new BadRequestException(
          `บทบาท "${g.role}" ใช้กับระบบ ${def.nameTh} ไม่ได้ (ใช้ได้: ${def.roles.map((r) => r.value).join(', ')})`,
        );
      }
      const permissions = g.permissions ? [...new Set(g.permissions)] : null;
      byTerminal.set(def.key, {
        terminal: def.key,
        role: g.role,
        permissions,
        approvalLimit:
          g.approvalLimit === undefined || g.approvalLimit === null
            ? def.key === 'procurement'
              ? (def.defaultApprovalLimits?.[g.role] ?? null)
              : null
            : Number(g.approvalLimit),
        scopeIds: g.scopeIds ? [...new Set(g.scopeIds)] : null,
      });
    }
    return [...byTerminal.values()];
  }

  /**
   * เขียนสิทธิ์ลงตาราง แล้ว sync กลับไปที่ users (allowedSystems / role / คอลัมน์สิทธิ์เดิม)
   *
   * `replace` = terminal ที่ไม่อยู่ในรายการถูกถอน (ลบแถว — มี audit ไว้ตาม)
   * `merge`   = เพิ่ม/แก้เฉพาะที่ส่งมา
   */
  async writeGrants(
    user: User,
    grants: NormalizedGrant[],
    actor: ActorContext,
    mode: 'replace' | 'merge',
    opts: { silent?: boolean } = {},
  ): Promise<void> {
    const tenantId = actor.tenantId;
    const existing = await this.prisma.userTerminalAccess.findMany({
      where: { userId: user.id, tenantId },
    });
    const existingByTerminal = new Map(existing.map((r) => [r.terminal, r]));
    const wanted = new Set(grants.map((g) => g.terminal));
    const now = new Date();

    for (const g of grants) {
      const row = existingByTerminal.get(g.terminal);
      const data = {
        role: g.role,
        permissions: g.permissions === null ? Prisma.JsonNull : g.permissions,
        approvalLimit: g.approvalLimit === null ? null : new Prisma.Decimal(g.approvalLimit),
        scopeIds: g.scopeIds === null ? Prisma.JsonNull : g.scopeIds,
        grantedBy: actor.userId,
        revokedAt: null as Date | null,
      };
      if (row) {
        await this.prisma.userTerminalAccess.update({
          where: { id: row.id },
          data: { ...data, ...(row.revokedAt ? { grantedAt: now } : {}) },
        });
      } else {
        await this.prisma.userTerminalAccess.create({
          data: { ...data, userId: user.id, tenantId, terminal: g.terminal, grantedAt: now },
        });
      }
    }

    const removed =
      mode === 'replace' ? existing.filter((r) => !wanted.has(r.terminal as TerminalKey)) : [];
    if (removed.length > 0) {
      await this.prisma.userTerminalAccess.deleteMany({
        where: { id: { in: removed.map((r) => r.id) } },
      });
    }

    // ── sync กลับไปที่ users ─────────────────────────────────────────────────
    const effective: NormalizedGrant[] =
      mode === 'replace'
        ? grants
        : [
            ...existing
              .filter((r) => !wanted.has(r.terminal as TerminalKey) && isTerminalKey(r.terminal))
              .map((r) => ({
                terminal: r.terminal as TerminalKey,
                role: r.role,
                permissions: this.jsonStringArray(r.permissions),
                approvalLimit: r.approvalLimit === null ? null : Number(r.approvalLimit),
                scopeIds: this.jsonStringArray(r.scopeIds),
              })),
            ...grants,
          ];

    // `main` (dashboard หลัก) ให้เฉพาะ: บัญชีที่มีอยู่แล้ว หรือถือบทบาทระดับหัวหน้า
    // ใน Terminal ใดก็ได้ — พนักงานหน้างานเข้าได้แค่ Terminal ของตน (ไม่เคยถอด main ที่มีอยู่)
    const previousSystems = this.parseStringArray(user.allowedSystems);
    const grantsMain =
      previousSystems.includes('main') || effective.some((g) => MANAGER_LEVEL_ROLES.has(g.role));
    const allowedSystems = [...(grantsMain ? ['main'] : []), ...effective.map((g) => g.terminal)];

    const data: Prisma.UserUpdateInput = { allowedSystems: JSON.stringify(allowedSystems) };
    if (!ADMIN_LIKE_ROLES.has(user.role) && effective.length > 0) {
      data.role = effective[0].role;
    }
    this.applyLegacyColumns(data, user, effective);

    await this.prisma.user.update({ where: { id: user.id }, data });

    if (opts.silent) return;

    const added = grants.filter((g) => !existingByTerminal.has(g.terminal));
    const changedRole = grants.filter((g) => {
      const row = existingByTerminal.get(g.terminal);
      return row && row.role !== g.role;
    });
    if (added.length > 0 || changedRole.length > 0) {
      await this.record(actor, AuditAction.TENANT_USER_ACCESS_GRANT, user.id, {
        description: `ให้สิทธิ์ ${user.email}: ${[...added, ...changedRole]
          .map((g) => `${g.terminal}:${g.role}`)
          .join(', ')}`,
        newValues: { grants: effective.map((g) => ({ terminal: g.terminal, role: g.role })) },
      });
    }
    if (removed.length > 0) {
      await this.record(actor, AuditAction.TENANT_USER_ACCESS_REVOKE, user.id, {
        description: `ถอนสิทธิ์ ${user.email}: ${removed.map((r) => r.terminal).join(', ')}`,
        oldValues: { revoked: removed.map((r) => ({ terminal: r.terminal, role: r.role })) },
        newValues: { grants: effective.map((g) => ({ terminal: g.terminal, role: g.role })) },
      });
    }
  }

  /**
   * คอลัมน์สิทธิ์เดิมที่ terminal ต่าง ๆ ยังอ่านอยู่ — เขียนให้ตรงเท่าที่ทำได้ถูก
   * (procurementPermissions / approvalLimit / warehousePermissions / warehouseIds /
   * metadata.permissions ของ hotel-terminal; accounting/hr ยืม warehousePermissions
   * จึงเขียนให้เฉพาะเมื่อไม่มี warehouse grant มาชน)
   */
  private applyLegacyColumns(
    data: Prisma.UserUpdateInput,
    user: User,
    grants: NormalizedGrant[],
  ): void {
    const byKey = new Map(grants.map((g) => [g.terminal, g]));
    const resolved = (g: NormalizedGrant) =>
      g.permissions ?? defaultPermissionsFor(g.terminal, g.role);

    const procurement = byKey.get('procurement');
    if (procurement) {
      data.procurementPermissions = JSON.stringify(resolved(procurement));
      data.approvalLimit =
        procurement.approvalLimit === null ? null : new Prisma.Decimal(procurement.approvalLimit);
    }

    const warehouse = byKey.get('warehouse');
    if (warehouse) {
      data.warehousePermissions = JSON.stringify(resolved(warehouse));
      data.warehouseIds = JSON.stringify(warehouse.scopeIds ?? []);
    } else {
      const borrower = byKey.get('accounting') ?? byKey.get('hr');
      if (borrower) data.warehousePermissions = JSON.stringify(resolved(borrower));
    }

    const hotel = byKey.get('hotel-terminal');
    if (hotel) {
      const meta = this.parseMetadata(user.metadata);
      data.metadata = JSON.stringify({ ...meta, permissions: resolved(hotel) });
    }
  }

  private async currentGrants(user: User): Promise<ResolvedGrant[]> {
    const rows = await this.prisma.userTerminalAccess.findMany({ where: { userId: user.id } });
    return this.resolveGrants(user, rows);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Loading / serialisation
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadTenantUsers(tenantId: string): Promise<TenantUser[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }],
    });
    if (users.length === 0) return [];
    return this.serializeMany(users, tenantId);
  }

  private async loadOne(id: string, tenantId: string): Promise<TenantUser> {
    const user = await this.findUserOrThrow(id, tenantId);
    const [one] = await this.serializeMany([user], tenantId);
    return one;
  }

  private async serializeMany(users: User[], tenantId: string): Promise<TenantUser[]> {
    const ids = users.map((u) => u.id);

    const [accessRows, twoFactorRows] = await Promise.all([
      this.prisma.userTerminalAccess.findMany({ where: { userId: { in: ids }, tenantId } }),
      this.prisma.user2FASettings.findMany({
        where: { userId: { in: ids }, isEnabled: true },
        select: { userId: true },
      }),
    ]);
    const accessByUser = new Map<string, UserTerminalAccess[]>();
    for (const row of accessRows) {
      const list = accessByUser.get(row.userId) ?? [];
      list.push(row);
      accessByUser.set(row.userId, list);
    }
    const twoFactorIds = new Set(twoFactorRows.map((r) => r.userId));

    // ตำแหน่ง/แผนกจาก HR: จับคู่ด้วย metadata.hrEmployeeId ก่อน แล้วค่อย employeeCode
    const metaByUser = new Map(users.map((u) => [u.id, this.parseMetadata(u.metadata)]));
    const hrIds = [...metaByUser.values()]
      .map((m) => m.hrEmployeeId)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    const codes = users.map((u) => u.employeeId).filter((v): v is string => !!v);
    const employees: EmployeeLite[] =
      hrIds.length || codes.length
        ? await this.prisma.employee.findMany({
            where: {
              tenantId,
              OR: [
                ...(hrIds.length ? [{ id: { in: hrIds } }] : []),
                ...(codes.length ? [{ employeeCode: { in: codes } }] : []),
              ],
            },
            select: { id: true, employeeCode: true, position: true, department: true },
          })
        : [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const employeeByCode = new Map(
      employees.filter((e) => e.employeeCode).map((e) => [e.employeeCode as string, e]),
    );

    return users.map((u) => {
      const meta = metaByUser.get(u.id) ?? {};
      const hrEmployeeId = typeof meta.hrEmployeeId === 'string' ? meta.hrEmployeeId : null;
      const employee =
        (hrEmployeeId ? employeeById.get(hrEmployeeId) : undefined) ??
        (u.employeeId ? employeeByCode.get(u.employeeId) : undefined) ??
        null;
      const grants = this.resolveGrants(u, accessByUser.get(u.id) ?? []);
      return this.toTenantUser(u, grants, {
        hrEmployeeId: hrEmployeeId ?? employee?.id ?? null,
        employee,
        twoFactorEnabled: twoFactorIds.has(u.id),
      });
    });
  }

  private toTenantUser(
    u: User,
    grants: ResolvedGrant[],
    extra: {
      hrEmployeeId: string | null;
      employee: EmployeeLite | null;
      twoFactorEnabled: boolean;
    },
  ): TenantUser {
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      fullName,
      avatarUrl: u.avatarUrl ?? null,
      phone: u.phone ?? null,
      primaryRole: u.role,
      status: this.effectiveStatus(u),
      employeeCode: u.employeeId ?? null,
      hrEmployeeId: extra.hrEmployeeId,
      position: extra.employee?.position ?? null,
      department: extra.employee?.department ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lastLoginIp: u.lastLoginIp ?? null,
      expiresAt: u.expiresAt?.toISOString() ?? null,
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
      suspendedReason: u.suspendedReason ?? null,
      twoFactorEnabled: extra.twoFactorEnabled,
      createdAt: u.createdAt.toISOString(),
      isOwner: this.isOwner(u),
      grants: grants.map<TerminalGrant>((g) => ({
        terminal: g.terminal,
        role: g.role,
        permissions: g.permissions,
        approvalLimit: g.approvalLimit,
        scopeIds: g.scopeIds,
        grantedAt: g.grantedAt,
        grantedBy: g.grantedBy,
      })),
    };
  }

  private effectiveStatus(u: User): UserStatus {
    const s = (u.status ?? 'active').toLowerCase();
    if (s === 'active' && u.expiresAt && u.expiresAt.getTime() < Date.now()) return 'expired';
    return (USER_STATUSES as readonly string[]).includes(s) ? (s as UserStatus) : 'inactive';
  }

  private async buildTerminalInfos(tenantId: string, users: TenantUser[]): Promise<TerminalInfo[]> {
    const availability = await this.terminalAvailability(tenantId);
    return TERMINAL_KEYS.map((key) => {
      const def = TERMINAL_REGISTRY[key];
      return {
        key,
        name: def.name,
        nameTh: def.nameTh,
        roles: def.roles,
        permissionCatalog: def.permissionCatalog,
        defaultPermissions: def.defaultPermissions,
        requiresAddon: def.requiresAddon,
        productLine: def.productLine,
        available: availability.get(key) ?? false,
        userCount: users.filter(
          (u) => u.status !== 'inactive' && u.grants.some((g) => g.terminal === key),
        ).length,
      };
    });
  }

  /**
   * terminal ไหนเปิดให้ tenant นี้: สายธุรกิจต้องตรง (HOTEL/CAMP) และถ้าต้องมี add-on
   * ต้องมี entitlement อยู่ — tenant ที่ยัง trial ได้ทุกโมดูล (เหมือน AddonGuard)
   */
  private async terminalAvailability(tenantId: string): Promise<Map<TerminalKey, boolean>> {
    let system: 'HOTEL' | 'CAMP' = 'HOTEL';
    let activeCodes = new Set<string>();
    let isTrial = false;
    try {
      const [sys, addons, subscription] = await Promise.all([
        this.addonService.getTenantSystem(tenantId),
        this.addonService.getActiveAddons(tenantId),
        this.subscriptionsService.findByTenantId(tenantId),
      ]);
      system = sys;
      activeCodes = new Set(addons.filter((a) => a.isActive).map((a) => a.code));
      isTrial = subscription?.status === 'trial';
    } catch (err) {
      this.logger.warn(
        `terminalAvailability fallback tenant=${tenantId}: ${this.errorMessage(err)}`,
      );
    }

    const map = new Map<TerminalKey, boolean>();
    for (const key of TERMINAL_KEYS) {
      const def = TERMINAL_REGISTRY[key];
      const lineOk = def.productLine === null || def.productLine === system;
      const addonOk = def.requiresAddon === null || isTrial || activeCodes.has(def.requiresAddon);
      map.set(key, lineOk && addonOk);
    }
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Guards / helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async findUserOrThrow(id: string, tenantId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('User not found or does not belong to your tenant');
    return user;
  }

  private isOwner(user: Pick<User, 'role'>): boolean {
    return OWNER_ROLES.has(user.role);
  }

  /** เจ้าของ tenant และตัวผู้เรียกเอง: ห้ามระงับ/ลบ/แก้สิทธิ์ผ่าน API นี้ */
  private assertEditable(user: User, actor: ActorContext): void {
    if (this.isOwner(user)) {
      throw new ForbiddenException({
        code: 'OWNER_PROTECTED',
        message: 'บัญชีเจ้าของระบบแก้ไขผ่านหน้านี้ไม่ได้',
      });
    }
    if (user.id === actor.userId) {
      throw new ForbiddenException({
        code: 'SELF_PROTECTED',
        message: 'แก้ไขสิทธิ์/สถานะของบัญชีตัวเองไม่ได้',
      });
    }
  }

  /** plans.max_users (0 หรือไม่มี = ไม่จำกัด) */
  private async maxUsersFor(tenantId: string): Promise<number | null> {
    try {
      const subscription = await this.subscriptionsService.findByTenantId(tenantId);
      const max = subscription?.plans_subscriptions_plan_idToplans?.max_users;
      return typeof max === 'number' && max > 0 ? max : null;
    } catch (err) {
      this.logger.warn(`maxUsersFor fallback tenant=${tenantId}: ${this.errorMessage(err)}`);
      return null;
    }
  }

  /** บังคับโควตาที่นั่งที่ API ไม่ใช่แค่ซ่อนปุ่มใน UI */
  private async assertSeatAvailable(tenantId: string): Promise<void> {
    const maxUsers = await this.maxUsersFor(tenantId);
    if (maxUsers === null) return;
    const seatsUsed = await this.prisma.user.count({
      where: { tenantId, status: 'active', role: { notIn: [...PLATFORM_ROLES] } },
    });
    if (seatsUsed >= maxUsers) {
      throw new ForbiddenException({
        code: 'SEAT_LIMIT_REACHED',
        message: `แพ็กเกจปัจจุบันรองรับผู้ใช้ได้ ${maxUsers} คน (ใช้ไปแล้ว ${seatsUsed})`,
        details: { seatsUsed, maxUsers },
      });
    }
  }

  private async record(
    actor: ActorContext,
    action: AuditAction,
    targetUserId: string,
    extra: {
      description?: string;
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.auditLog.log({
      action,
      resource: AuditResource.USER,
      category: AuditCategory.USER_MANAGEMENT,
      resourceId: targetUserId,
      tenantId: actor.tenantId,
      userId: actor.userId,
      ipAddress: actor.ip,
      description: extra.description,
      oldValues: extra.oldValues,
      newValues: extra.newValues,
    });
  }

  /** รหัสผ่านชั่วคราว 12 ตัว มีตัวพิมพ์ใหญ่/เล็ก/ตัวเลข/สัญลักษณ์อย่างน้อยอย่างละหนึ่ง */
  generatePassword(length = 12): string {
    const sets = [
      'ABCDEFGHJKLMNPQRSTUVWXYZ',
      'abcdefghijkmnpqrstuvwxyz',
      '23456789',
      '!@#$%^&*-_=+',
    ];
    const all = sets.join('');
    const chars = sets.map((s) => s[randomInt(s.length)]);
    while (chars.length < length) chars.push(all[randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  private parseMetadata(raw: string | null): UserMetadata {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as UserMetadata) : {};
    } catch {
      return {};
    }
  }

  private parseStringArray(raw: string | null | undefined): string[] {
    return this.parseStringArrayOrNull(raw) ?? [];
  }

  private parseStringArrayOrNull(raw: string | null | undefined): string[] | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string')
        : null;
    } catch {
      return null;
    }
  }

  private jsonStringArray(value: Prisma.JsonValue | null): string[] | null {
    if (!Array.isArray(value)) return null;
    return value.filter((v): v is string => typeof v === 'string');
  }

  private errorMessage(err: unknown): string {
    if (err instanceof ForbiddenException || err instanceof BadRequestException) {
      const res = err.getResponse();
      if (typeof res === 'string') return res;
      if (res && typeof res === 'object' && 'message' in res) {
        const m = (res as { message: unknown }).message;
        return Array.isArray(m) ? m.join(', ') : String(m);
      }
    }
    return err instanceof Error ? err.message : String(err);
  }
}

/** สิทธิ์ที่อ่านออกมาแล้ว (resolve default เรียบร้อย + จำได้ว่าเป็น override หรือไม่) */
export interface ResolvedGrant extends TerminalGrant {
  permissionsOverride: string[] | null;
}
