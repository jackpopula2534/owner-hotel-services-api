import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../audit-log/audit-log.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLogService: AuditLogService,
  ) {}

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { role, status, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            tenantId: true,
            createdAt: true,
            updatedAt: true,
            // ไม่ส่ง password ออกไป
          },
        }),
        this.prisma.user.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      // ถ้าเกิด database error ให้ส่ง empty data
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return {
            data: [],
            total: 0,
            page,
            limit,
          };
        }
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const user = await this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: any, tenantId?: string, userId?: string) {
    const oldData = await this.findOne(id, tenantId);

    // ไม่ให้อัพเดท password ผ่าน endpoint นี้ (ใช้ password reset แทน)
    const { password, ...safeData } = updateUserDto;

    const result = await this.prisma.user.update({
      where: { id },
      data: safeData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.auditLogService.logUserUpdate(id, oldData, result, userId, tenantId);
    return result;
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.user.delete({
      where: { id },
    });
  }
}
