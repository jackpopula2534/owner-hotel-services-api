import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';

@Injectable()
export class FiscalYearsService {
  private readonly logger = new Logger(FiscalYearsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, propertyId?: string) {
    return this.prisma.fiscalYear.findMany({
      where: { tenantId, ...(propertyId ? { propertyId } : {}) },
      orderBy: [{ year: 'desc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const fy = await this.prisma.fiscalYear.findFirst({ where: { id, tenantId } });
    if (!fy) throw new NotFoundException(`Fiscal year ${id} not found`);
    return fy;
  }

  /**
   * ปีบัญชีที่เปิดอยู่ของวันนี้ — ยังไม่ได้ตั้งปีบัญชีเป็นเรื่องปกติของ tenant ใหม่ คืน null (ไม่ใช่ 404)
   * หัวหน้าเพจบัญชีเรียกทุกหน้า ถ้าโยน 404 จะมี error แดงทุกครั้งที่เปิดเพจ
   */
  async findCurrent(tenantId: string, propertyId: string) {
    const now = new Date();
    const fy = await this.prisma.fiscalYear.findFirst({
      where: {
        tenantId,
        propertyId,
        status: 'OPEN',
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });
    return fy ?? null;
  }

  async create(dto: CreateFiscalYearDto, tenantId: string) {
    const existing = await this.prisma.fiscalYear.findFirst({
      where: { tenantId, propertyId: dto.propertyId, year: dto.year },
    });
    if (existing) throw new ConflictException(`Fiscal year ${dto.year} already exists`);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) throw new BadRequestException('End date must be after start date');

    return this.prisma.fiscalYear.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        year: dto.year,
        startDate,
        endDate,
        status: 'OPEN',
      },
    });
  }

  async close(id: string, tenantId: string, closedBy: string) {
    const fy = await this.findOne(id, tenantId);
    if (fy.status === 'CLOSED') throw new BadRequestException('Fiscal year is already closed');
    if (fy.status === 'LOCKED') throw new BadRequestException('Fiscal year is locked');

    return this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'CLOSED', closedBy, closedAt: new Date() },
    });
  }

  async lock(id: string, tenantId: string, lockedBy: string) {
    const fy = await this.findOne(id, tenantId);
    if (fy.status === 'LOCKED') throw new BadRequestException('Fiscal year is already locked');

    return this.prisma.fiscalYear.update({
      where: { id },
      data: { status: 'LOCKED', closedBy: lockedBy, closedAt: new Date() },
    });
  }
}
