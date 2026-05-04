import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CreateGuestDto } from './dto/create-guest.dto';
import { UpdateGuestDto } from './dto/update-guest.dto';

@Injectable()
export class GuestsService {
  constructor(
    private prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Allowlist of Prisma `Guest` columns that are safe to write from API DTOs.
   * Keep this in sync with the Prisma schema (`prisma/schema.prisma`) and the
   * Create/Update DTOs in `./dto/`.
   */
  private static readonly WRITABLE_FIELDS = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'nationalId',
    'passportNumber',
    'dateOfBirth',
    'nationality',
    'address',
    'city',
    'country',
    'postalCode',
    'isVip',
    'vipLevel',
    'vehiclePlateNumber',
    'specialNotes',
  ] as const;

  /** Pick only writable fields from a DTO and drop undefined values. */
  private sanitize(dto: CreateGuestDto | UpdateGuestDto): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const source = dto as Record<string, unknown>;
    for (const key of GuestsService.WRITABLE_FIELDS) {
      const value = source[key];
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  private buildWhere(tenantId: string, search?: string) {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }
    return where;
  }

  async findAll(query: any, tenantId?: string) {
    // ถ้าไม่มี tenantId (ผู้ใช้ใหม่) ให้ส่ง empty array กลับไป
    if (!tenantId) {
      return {
        data: [],
        total: 0,
        page: 1,
        limit: parseInt(query.limit) || 10,
      };
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const search = query.search;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(tenantId, search);

    try {
      const [data, total] = await Promise.all([
        this.prisma.guest.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.guest.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      // Handle Prisma errors (e.g., P2021: table not exist)
      if (error.code === 'P2021' || error.code === 'P2022') {
        return {
          data: [],
          total: 0,
          page,
          limit,
        };
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

    try {
      const guest = await this.prisma.guest.findFirst({
        where,
        include: { bookings: true },
      });

      if (!guest) {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }

      return guest;
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }

  async create(createGuestDto: CreateGuestDto, tenantId?: string, userId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Defense-in-depth: pick only schema-allowed fields to prevent unknown
    // keys from leaking into Prisma when this service is called from internal
    // code that bypasses the ValidationPipe whitelist. firstName/lastName are
    // guaranteed by CreateGuestDto's @IsNotEmpty validators.
    const data = {
      ...this.sanitize(createGuestDto),
      tenantId,
    } as Parameters<PrismaService['guest']['create']>[0]['data'];

    try {
      const result = await this.prisma.guest.create({
        data,
      });

      // Audit logging (non-blocking)
      this.auditLogService.logGuestCreate(result, userId, tenantId).catch(() => {
        // Silently ignore audit log errors to prevent blocking guest creation
      });

      return result;
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new BadRequestException('Guest table does not exist. Please contact administrator.');
      }
      throw error;
    }
  }

  async update(id: string, updateGuestDto: UpdateGuestDto, tenantId?: string, userId?: string) {
    const oldGuest = await this.findOne(id, tenantId);

    // Defense-in-depth: keep only schema-allowed fields. Prisma throws a
    // PrismaClientValidationError on unknown keys, which surfaces as a
    // confusing "ข้อมูลไม่ถูกต้องตามโครงสร้างฐานข้อมูล" error to the client.
    const data = this.sanitize(updateGuestDto);

    try {
      const result = await this.prisma.guest.update({
        where: { id },
        data,
      });

      // Audit logging (non-blocking)
      this.auditLogService.logGuestUpdate(id, oldGuest, result, userId, tenantId).catch(() => {
        // Silently ignore audit log errors to prevent blocking guest update
      });

      return result;
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    try {
      return await this.prisma.guest.delete({
        where: { id },
      });
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }
}
