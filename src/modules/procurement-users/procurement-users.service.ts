import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import {
  CreateProcurementUserDto,
  PROCUREMENT_ROLES,
  type ProcurementRole,
} from './dto/create-procurement-user.dto';
import { UpdateProcurementUserDto } from './dto/update-procurement-user.dto';

export interface ProcurementUserResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
  approvalLimit: number | null;
  permissions: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * A User row shape tolerant of stale Prisma Client types.
 * Includes the new procurement-specific columns added in the schema so we
 * can typecheck the response builder even before `npx prisma generate` runs.
 */
interface UserLike {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
  approvalLimit: Prisma.Decimal | null;
  procurementPermissions: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

/** Default per-role approval ceilings (THB). null = unlimited. */
const DEFAULT_ROLE_LIMITS: Record<ProcurementRole, number | null> = {
  procurement_manager: null,
  buyer: 50_000,
  approver: 500_000,
  receiver: 0,
};

/** Default permission matrix by role. */
const DEFAULT_ROLE_PERMISSIONS: Record<ProcurementRole, string[]> = {
  procurement_manager: [
    'pr.create',
    'pr.approve',
    'rfq.create',
    'quote.compare',
    'po.create',
    'po.approve',
    'supplier.manage',
    'grn.view',
    'report.view',
    'approval-flow.manage',
    'user.manage',
  ],
  buyer: ['pr.create', 'rfq.create', 'quote.compare', 'po.create', 'supplier.view', 'report.view'],
  approver: ['pr.approve', 'po.approve', 'quote.compare', 'report.view'],
  receiver: ['grn.create', 'grn.view', 'qc.inspect'],
};

@Injectable()
export class ProcurementUsersService {
  private readonly logger = new Logger(ProcurementUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Build allowedSystems JSON for procurement users (manager gets main too). */
  private allowedSystemsFor(role: ProcurementRole): string {
    return role === 'procurement_manager' || role === 'approver'
      ? '["main","procurement"]'
      : '["main","procurement"]';
  }

  async create(
    dto: CreateProcurementUserDto,
    tenantId: string,
  ): Promise<{ success: true; data: ProcurementUserResponse }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(`A user with email "${dto.email}" already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const permissions = dto.permissions ?? DEFAULT_ROLE_PERMISSIONS[dto.role];
    const approvalLimit =
      dto.approvalLimit ?? DEFAULT_ROLE_LIMITS[dto.role] ?? null;

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
        approvalLimit:
          approvalLimit === null ? null : (approvalLimit as unknown as Prisma.Decimal),
        procurementPermissions: JSON.stringify(permissions),
      } as unknown as Prisma.UserCreateInput,
    });

    this.logger.log(
      `Procurement user created: ${user.email} (role=${user.role}, limit=${approvalLimit ?? '∞'}) tenant=${tenantId}`,
    );

    return { success: true, data: this.format(user as unknown as UserLike) };
  }

  async findAll(
    tenantId: string,
  ): Promise<{ success: true; data: ProcurementUserResponse[] }> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: PROCUREMENT_ROLES as unknown as string[] },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });
    return {
      success: true,
      data: users.map((u) => this.format(u as unknown as UserLike)),
    };
  }

  async findOne(
    userId: string,
    tenantId: string,
  ): Promise<{ success: true; data: ProcurementUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('Procurement user not found');
    return { success: true, data: this.format(user as unknown as UserLike) };
  }

  async update(
    userId: string,
    tenantId: string,
    dto: UpdateProcurementUserDto,
  ): Promise<{ success: true; data: ProcurementUserResponse }> {
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
    if (dto.approvalLimit !== undefined) {
      data.approvalLimit =
        dto.approvalLimit === null
          ? null
          : (dto.approvalLimit as unknown as Prisma.Decimal);
    }
    if (dto.permissions !== undefined) {
      data.procurementPermissions = JSON.stringify(dto.permissions);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: data as Prisma.UserUpdateInput,
    });
    return { success: true, data: this.format(updated as unknown as UserLike) };
  }

  async remove(userId: string, tenantId: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('Procurement user not found');

    // Soft-disable instead of hard delete (keeps audit trail / foreign keys).
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
    return { success: true };
  }

  /** Stats: totals, by-role, active-today, etc. */
  async stats(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: PROCUREMENT_ROLES as unknown as string[] },
      },
      select: { role: true, status: true, lastLoginAt: true },
    });
    const now = Date.now();
    const byRole: Record<string, number> = {};
    for (const role of PROCUREMENT_ROLES) byRole[role] = 0;

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

  /** Serialize User row → compact procurement user response. */
  private format(user: UserLike): ProcurementUserResponse {
    let permissions: string[] = [];
    if (user.procurementPermissions) {
      try {
        const parsed = JSON.parse(user.procurementPermissions);
        if (Array.isArray(parsed)) {
          permissions = parsed.filter((p): p is string => typeof p === 'string');
        }
      } catch {
        permissions = [];
      }
    }
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      employeeId: user.employeeId,
      approvalLimit: user.approvalLimit === null ? null : Number(user.approvalLimit),
      permissions,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
