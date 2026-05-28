import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWhtCertDto } from './dto/create-wht-cert.dto';

interface WhtCertQuery {
  propertyId?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class WhtCertificatesService {
  private readonly logger = new Logger(WhtCertificatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generateCertNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'WHT', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'WHT', prefix: 'WHT', yearMonth, lastNumber: 1 },
    });
    return `WHT-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: WhtCertQuery) {
    const { page = 1, limit = 20, propertyId, supplierId, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.paymentDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.whtCertificate.count({ where }),
      this.prisma.whtCertificate.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, taxId: true } },
        },
        orderBy: [{ paymentDate: 'desc' }, { certNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const cert = await this.prisma.whtCertificate.findFirst({
      where: { id, tenantId },
      include: {
        supplier: { select: { id: true, name: true, taxId: true, address: true } },
      },
    });
    if (!cert) throw new NotFoundException(`WHT Certificate ${id} not found`);
    return cert;
  }

  async create(dto: CreateWhtCertDto, tenantId: string, issuedBy: string) {
    const certNo = await this.generateCertNo(tenantId);
    const whtAmount = (dto.incomeAmount * dto.whtRate) / 100;

    const cert = await this.prisma.whtCertificate.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        certNo,
        supplier: { connect: { id: dto.supplierId } },
        apPayment: dto.apPaymentId ? { connect: { id: dto.apPaymentId } } : undefined,
        paymentDate: new Date(dto.paymentDate),
        incomeType: dto.incomeType,
        incomeAmount: dto.incomeAmount,
        whtRate: dto.whtRate,
        whtAmount,
        status: 'DRAFT',
        payeeName: dto.payeeName,
        payeeTaxId: dto.payeeTaxId,
        payeeAddress: dto.payeeAddress,
        issuerName: dto.issuerName,
        issuerTaxId: dto.issuerTaxId,
        issuedBy,
        createdBy: issuedBy,
      },
    });

    this.logger.log(`Created WHT Certificate ${certNo} for tenant ${tenantId}`);
    return cert;
  }

  async issue(id: string, tenantId: string, issuedBy: string) {
    const cert = await this.findOne(id, tenantId);
    if (cert.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot issue certificate with status: ${cert.status}`);
    }

    const updated = await this.prisma.whtCertificate.update({
      where: { id },
      data: { status: 'ISSUED', issuedBy, issuedAt: new Date() },
    });

    this.logger.log(`WHT Certificate ${cert.certNo} issued by ${issuedBy}`);
    return updated;
  }

  async void(id: string, tenantId: string, voidedBy: string) {
    const cert = await this.findOne(id, tenantId);
    if (cert.status === 'VOID') {
      throw new BadRequestException('Certificate is already void');
    }

    const updated = await this.prisma.whtCertificate.update({
      where: { id },
      data: { status: 'VOID', voidedBy, voidedAt: new Date() },
    });

    this.logger.log(`WHT Certificate ${cert.certNo} voided by ${voidedBy}`);
    return updated;
  }
}
