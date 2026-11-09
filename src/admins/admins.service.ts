import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';

// Fields safe to expose to API consumers — password hash is intentionally excluded.
const ADMIN_PUBLIC_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  menuAccess: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminSelect;

type AdminPublicRow = Prisma.AdminGetPayload<{ select: typeof ADMIN_PUBLIC_SELECT }>;

@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createAdminDto: CreateAdminDto) {
    if (!createAdminDto.password) {
      throw new BadRequestException('Password is required');
    }

    const data = await this.buildAdminData(createAdminDto);
    if (!data.role) data.role = 'platform_admin';

    const admin = await this.prisma.admin.create({
      data: data as unknown as Prisma.AdminCreateInput,
      select: ADMIN_PUBLIC_SELECT,
    });
    return this.toPublic(admin);
  }

  async findAll() {
    const admins = await this.prisma.admin.findMany({
      select: ADMIN_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return admins.map((a) => this.toPublic(a));
  }

  async findOne(id: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id },
      select: ADMIN_PUBLIC_SELECT,
    });
    if (!admin) throw new NotFoundException('Admin not found');
    return this.toPublic(admin);
  }

  findByEmail(email: string) {
    return this.prisma.admin.findUnique({
      where: { email },
    });
  }

  async update(id: string, updateAdminDto: UpdateAdminDto) {
    const data = await this.buildAdminData(updateAdminDto);

    const admin = await this.prisma.admin.update({
      where: { id },
      data: data as unknown as Prisma.AdminUpdateInput,
      select: ADMIN_PUBLIC_SELECT,
    });
    return this.toPublic(admin);
  }

  async remove(id: string) {
    await this.prisma.admin.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Build a Prisma-safe data object from the DTO:
   * - hashes the password (only when provided)
   * - maps a full `name` into firstName/lastName when first/last are absent
   * - normalises `menuAccess` (an explicit empty array means "full access")
   */
  private async buildAdminData(
    dto: CreateAdminDto | UpdateAdminDto,
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;

    if (dto.name !== undefined && dto.firstName === undefined && dto.lastName === undefined) {
      const parts = dto.name.trim().split(/\s+/).filter(Boolean);
      data.firstName = parts.shift() ?? '';
      data.lastName = parts.length ? parts.join(' ') : null;
    }

    if (dto.menuAccess !== undefined) {
      data.menuAccess = Array.isArray(dto.menuAccess) ? dto.menuAccess : [];
    }

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    return data;
  }

  private toPublic(admin: AdminPublicRow) {
    const fullName = [admin.firstName, admin.lastName].filter(Boolean).join(' ').trim();
    return {
      ...admin,
      name: fullName,
      menuAccess: (admin.menuAccess as string[] | null) ?? [],
    };
  }
}
