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
  CreateWarehouseUserDto,
  WAREHOUSE_ROLES,
  DEFAULT_WAREHOUSE_PERMISSIONS,
  type WarehouseRole,
} from './dto/create-warehouse-user.dto';
import { UpdateWarehouseUserDto } from './dto/update-warehouse-user.dto';

export interface WarehouseUserResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: string;
  employeeId: string | null;
  permissions: string[];
  warehouseIds: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

/**
 * A User row shape tolerant of stale Prisma Client types.
 * Includes the new warehouse-specific columns added in the schema so we
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
  warehousePermissions: string | null;
  warehouseIds: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
}

@Injectable()
export class WarehouseUsersService {
  private readonly logger = new Logger(WarehouseUsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Build allowedSystems JSON for warehouse users (always include main + warehouse). */
  private allowedSystemsFor(_role: WarehouseRole): string {
    return '["main","warehouse"]';
  }

  async create(
    dto: CreateWarehouseUserDto,
    tenantId: string,
  ): Promise<{ success: true; data: WarehouseUserResponse }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException(`A user with email "${dto.email}" already exists`);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const permissions = dto.permissions ?? DEFAULT_WAREHOUSE_PERMISSIONS[dto.role];
    const warehouseIds = dto.warehouseIds ?? [];

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
          allowedSystems: this.allowedSystemsFor(dto.role),
          warehousePermissions: JSON.stringify(permissions),
          warehouseIds: JSON.stringify(warehouseIds),
        } as unknown as Prisma.UserCreateInput,
      });

      this.logger.log(
        `Warehouse user created: ${user.email} (role=${user.role}, warehouses=${warehouseIds.length || 'all'}) tenant=${tenantId}`,
      );

      return { success: true, data: this.format(user as unknown as UserLike) };
    } catch (error) {
      // If the Prisma Client does not yet know about the warehousePermissions
      // / warehouseIds columns, this throws PrismaClientValidationError. Run
      // `npx prisma generate` after applying the migration to fix.
      this.logger.error(
        `Failed to create warehouse user ${dto.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async findAll(tenantId: string): Promise<{ success: true; data: WarehouseUserResponse[] }> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: { in: WAREHOUSE_ROLES as unknown as string[] },
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
  ): Promise<{ success: true; data: WarehouseUserResponse }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('Warehouse user not found');
    return { success: true, data: this.format(user as unknown as UserLike) };
  }

  async update(
    userId: string,
    tenantId: string,
    dto: UpdateWarehouseUserDto,
  ): Promise<{ success: true; data: WarehouseUserResponse }> {
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
    if (dto.permissions !== undefined) {
      data.warehousePermissions = JSON.stringify(dto.permissions);
    }
    if (dto.warehouseIds !== undefined) {
      data.warehouseIds = JSON.stringify(dto.warehouseIds);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: data as Prisma.UserUpdateInput,
      });
      return { success: true, data: this.format(updated as unknown as UserLike) };
    } catch (error) {
      // Surface the underlying Prisma error so the caller (and the frontend)
      // can see exactly which field/column is rejected. The most common cause
      // here is "Prisma Client does not recognize warehousePermissions" — which
      // means the developer needs to run `npx prisma generate` and apply the
      // migration that adds those columns to the `users` table.
      this.logger.error(
        `Failed to update warehouse user ${userId}: ${
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
    if (!user) throw new NotFoundException('Warehouse user not found');

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
        role: { in: WAREHOUSE_ROLES as unknown as string[] },
      },
      select: { role: true, status: true, lastLoginAt: true },
    });
    const now = Date.now();
    const byRole: Record<string, number> = {};
    for (const role of WAREHOUSE_ROLES) byRole[role] = 0;

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

  /** Serialize User row → compact warehouse user response. */
  private format(user: UserLike): WarehouseUserResponse {
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
    let warehouseIds: string[] = [];
    if (user.warehouseIds) {
      try {
        const parsed = JSON.parse(user.warehouseIds);
        if (Array.isArray(parsed)) {
          warehouseIds = parsed.filter((p): p is string => typeof p === 'string');
        }
      } catch {
        warehouseIds = [];
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
      warehouseIds,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
