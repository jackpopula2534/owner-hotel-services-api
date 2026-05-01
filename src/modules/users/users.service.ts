import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { UserStatus } from './constants/user-status.enum';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { SetUserExpirationDto } from './dto/set-user-expiration.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  expiresAt: true,
  suspendedAt: true,
  suspendedBy: true,
  suspendedReason: true,
  deactivatedAt: true,
  lastLoginAt: true,
  lastLoginIp: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CallerContext = {
  callerId?: string;
  callerRole?: string;
  ipAddress?: string;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
  ) {}

  /**
   * List users — `tenantId` กำหนดจาก controller
   * - tenant_admin / admin: tenantId = ของตัวเอง (required)
   * - platform_admin: tenantId = undefined (cross-tenant) แต่ส่งใน query ได้เพื่อ filter
   */
  async findAll(query: AdminListUsersQueryDto, tenantId?: string) {
    const isCrossTenant = tenantId === undefined;

    // ถ้าไม่ใช่ platform_admin ต้องบังคับ tenantId
    if (!isCrossTenant && !tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    // platform_admin override → ใช้ tenantId จาก query ได้
    if (!isCrossTenant) {
      where.tenantId = tenantId;
    } else if (query.tenantId) {
      where.tenantId = query.tenantId;
    }

    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search } },
        { lastName: { contains: query.search } },
        { email: { contains: query.search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: SAFE_USER_SELECT as any,
        }),
        this.prisma.user.count({ where }),
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
    const where: Prisma.UserWhereInput = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const user = (await this.prisma.user.findFirst({
      where,
      select: SAFE_USER_SELECT as any,
    })) as any;

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: any, tenantId?: string, userId?: string) {
    const oldData = await this.findOne(id, tenantId);

    // ห้ามแก้ password / status / expiration ผ่าน endpoint นี้ (ใช้ endpoint เฉพาะ)
    const { password, status, expiresAt, suspendedAt, suspendedBy, suspendedReason, deactivatedAt, ...safeData } = updateUserDto;

    const result = await this.prisma.user.update({
      where: { id },
      data: safeData,
      select: SAFE_USER_SELECT,
    });

    await this.auditLogService.logUserUpdate(id, oldData, result, userId, tenantId);
    return result;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);
    return this.prisma.user.delete({ where: { id } });
  }

  // ==========================================================================
  // Lifecycle endpoints (status / suspend / activate / deactivate / expiration)
  // ==========================================================================

  /**
   * เปลี่ยน status แบบ generic (รองรับทั้ง 4 ค่า)
   * — ส่ง reason ได้เมื่อ status = suspended
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    tenantId: string | undefined,
    caller: CallerContext,
  ) {
    if (caller.callerId === id) {
      throw new ForbiddenException('ไม่สามารถเปลี่ยนสถานะของบัญชีตนเองได้');
    }

    const oldUser = await this.findOne(id, tenantId);

    if (oldUser.status === dto.status) {
      // idempotent: ไม่ทำอะไร แต่ส่งสถานะปัจจุบันกลับ
      return oldUser;
    }

    const data = this.buildStatusTransition(dto.status, dto.reason, caller.callerId);

    const updated = await this.prisma.user.update({
      where: { id },
      data: data as Prisma.UserUpdateInput,
      select: SAFE_USER_SELECT as any,
    });

    // Invalidate refresh tokens เมื่อ user ถูก suspend / inactive / expired
    if (dto.status !== UserStatus.ACTIVE) {
      await this.revokeAllUserRefreshTokens(id);
    }

    await this.auditLogService.logUserStatusChange(
      id,
      oldUser.status,
      dto.status,
      caller.callerId ?? 'system',
      { reason: dto.reason, tenantId, ipAddress: caller.ipAddress },
    );

    return updated;
  }

  async suspend(id: string, dto: SuspendUserDto, tenantId: string | undefined, caller: CallerContext) {
    return this.updateStatus(
      id,
      { status: UserStatus.SUSPENDED, reason: dto.reason },
      tenantId,
      caller,
    );
  }

  async activate(id: string, tenantId: string | undefined, caller: CallerContext) {
    return this.updateStatus(id, { status: UserStatus.ACTIVE }, tenantId, caller);
  }

  async deactivate(id: string, tenantId: string | undefined, caller: CallerContext) {
    return this.updateStatus(id, { status: UserStatus.INACTIVE }, tenantId, caller);
  }

  async setExpiration(
    id: string,
    dto: SetUserExpirationDto,
    tenantId: string | undefined,
    caller: CallerContext,
  ) {
    const oldUser = await this.findOne(id, tenantId);

    const newExpiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;

    if (newExpiresAt && Number.isNaN(newExpiresAt.getTime())) {
      throw new BadRequestException('expiresAt ไม่ใช่วันที่ที่ถูกต้อง');
    }

    // ถ้ากำหนดเวลาในอดีต → set status = expired ทันที
    // ใช้ any เพราะ Prisma client อาจยังไม่ regenerate หลัง schema change
    const updateData: Record<string, any> = { expiresAt: newExpiresAt };
    if (newExpiresAt && newExpiresAt.getTime() <= Date.now()) {
      updateData.status = UserStatus.EXPIRED;
    } else if (oldUser.status === UserStatus.EXPIRED && (!newExpiresAt || newExpiresAt.getTime() > Date.now())) {
      // ขยายอายุของ user ที่หมดอายุไปแล้ว → กลับมา active
      updateData.status = UserStatus.ACTIVE;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData as Prisma.UserUpdateInput,
      select: SAFE_USER_SELECT as any,
    });

    if (updateData.status === UserStatus.EXPIRED) {
      await this.revokeAllUserRefreshTokens(id);
    }

    await this.auditLogService.logUserExpirationSet(
      id,
      oldUser.expiresAt ?? null,
      newExpiresAt,
      caller.callerId ?? 'system',
      tenantId,
      caller.ipAddress,
    );

    return updated;
  }

  // ==========================================================================
  // Internal helpers
  // ==========================================================================

  // ใช้ Record<string, any> เพราะ Prisma client อาจยังไม่ regenerate
  // หลัง schema change — caller ต้อง cast เป็น Prisma.UserUpdateInput อีกที
  private buildStatusTransition(
    status: UserStatus,
    reason: string | undefined,
    actorId: string | undefined,
  ): Record<string, any> {
    switch (status) {
      case UserStatus.ACTIVE:
        return {
          status,
          suspendedAt: null,
          suspendedBy: null,
          suspendedReason: null,
          deactivatedAt: null,
        };
      case UserStatus.SUSPENDED:
        return {
          status,
          suspendedAt: new Date(),
          suspendedBy: actorId ?? null,
          suspendedReason: reason ?? null,
        };
      case UserStatus.INACTIVE:
        return {
          status,
          deactivatedAt: new Date(),
        };
      case UserStatus.EXPIRED:
        return { status };
      default:
        throw new BadRequestException(`Unsupported status: ${status}`);
    }
  }

  private async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    try {
      const result = await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count > 0) {
        this.logger.log(`Revoked ${result.count} refresh token(s) for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to revoke refresh tokens for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
