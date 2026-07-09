import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import * as bcrypt from 'bcrypt';
import type { Prisma } from '@prisma/client';
import {
  CreateHrTerminalUserDto,
  HR_ROLES,
  DEFAULT_HR_PERMISSIONS,
  type HrRole,
} from './dto/create-hr-terminal-user.dto';
import { UpdateHrTerminalUserDto } from './dto/update-hr-terminal-user.dto';

export interface HrTerminalUserResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
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
  warehousePermissions: string | null; // reuse column for HR perms (same as accounting-users)
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

@Injectable()
export class HrTerminalUsersService {
  private readonly logger = new Logger(HrTerminalUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(
    dto: CreateHrTerminalUserDto,
    tenantId: string,
  ): Promise<{ success: true; data: HrTerminalUserResponse }> {
    const existing = await this.tenantContext.runUnscoped(() =>
      this.prisma.user.findFirst({ where: { email: dto.email } }),
    );
    if (existing) {
      throw new ConflictException(`A user with email "${dto.email}" already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const permissions = dto.permissions ?? DEFAULT_HR_PERMISSIONS[dto.role as HrRole] ?? [];

    try {
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
          allowedSystems: JSON.stringify(['main', 'hr']),
          warehousePermissions: JSON.stringify(permissions),
        } as unknown as Prisma.UserCreateInput,
      });

      this.logger.log(`HR user created: ${user.email} (role=${user.role}) tenant=${tenantId}`);

      return { success: true, data: this.format(user as unknown as UserLike) };
    } catch (error) {
      this.logger.error(
        `Failed to create HR user ${dto.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async findAll(tenantId: string): Promise<{ success: true; data: HrTerminalUserResponse[] }> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: HR_ROLES as unknown as string[] },
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
  ): Promise<{ success: true; data: HrTerminalUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('HR user not found');
    return { success: true, data: this.format(user as unknown as UserLike) };
  }

  async update(
    userId: string,
    tenantId: string,
    dto: UpdateHrTerminalUserDto,
  ): Promise<{ success: true; data: HrTerminalUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) {
      throw new BadRequestException('User not found or does not belong to your tenant');
    }

    const data: Record<string, unknown> = {};
    if (dto.role) {
      data.role = dto.role;
      data.allowedSystems = JSON.stringify(['main', 'hr']);
    }
    if (dto.status) data.status = dto.status;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.permissions !== undefined) {
      data.warehousePermissions = JSON.stringify(dto.permissions);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: data as Prisma.UserUpdateInput,
      });
      return { success: true, data: this.format(updated as unknown as UserLike) };
    } catch (error) {
      this.logger.error(
        `Failed to update HR user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async remove(userId: string, tenantId: string): Promise<{ success: true }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('HR user not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
    return { success: true };
  }

  async stats(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: HR_ROLES as unknown as string[] },
      },
      select: { role: true, status: true, lastLoginAt: true },
    });

    const now = Date.now();
    const byRole: Record<string, number> = {};
    for (const role of HR_ROLES) byRole[role] = 0;

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

  private format(user: UserLike): HrTerminalUserResponse {
    let permissions: string[] = [];
    if (user.warehousePermissions) {
      try {
        const parsed = JSON.parse(user.warehousePermissions);
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
      permissions,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
