import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { WhtIncomeType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTaxRateDto, TaxType } from './dto/create-tax-rate.dto';

@Injectable()
export class TaxRatesService {
  private readonly logger = new Logger(TaxRatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, type?: TaxType) {
    const where: Record<string, unknown> = { tenantId };
    if (type) where.type = type;

    const data = await this.prisma.taxRate.findMany({
      where,
      orderBy: [{ type: 'asc' }, { rate: 'asc' }],
    });

    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const taxRate = await this.prisma.taxRate.findFirst({ where: { id, tenantId } });
    if (!taxRate) throw new NotFoundException(`Tax rate ${id} not found`);
    return taxRate;
  }

  async create(dto: CreateTaxRateDto, tenantId: string) {
    const existing = await this.prisma.taxRate.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Tax rate with code '${dto.code}' already exists`);
    }

    const taxRate = await this.prisma.taxRate.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type,
        rate: dto.rate,
        taxPayableAccountId: dto.taxPayableAccountId,
        taxInputAccountId: dto.taxInputAccountId,
        whtIncomeType: dto.whtIncomeType,
        isDefault: dto.isDefault ?? false,
        isActive: true,
        description: dto.description,
      },
    });

    this.logger.log(`Created tax rate ${dto.code} for tenant ${tenantId}`);
    return taxRate;
  }

  async update(id: string, dto: Partial<CreateTaxRateDto>, tenantId: string) {
    await this.findOne(id, tenantId);

    const updated = await this.prisma.taxRate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.rate !== undefined && { rate: dto.rate }),
        ...(dto.taxPayableAccountId !== undefined && {
          taxPayableAccountId: dto.taxPayableAccountId,
        }),
        ...(dto.taxInputAccountId !== undefined && { taxInputAccountId: dto.taxInputAccountId }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    return updated;
  }

  async seedDefaults(tenantId: string) {
    const defaults = [
      { code: 'VAT_7', name: 'VAT 7%', type: TaxType.VAT, rate: 7, isDefault: true },
      { code: 'VAT_0', name: 'VAT 0% (Zero-rated)', type: TaxType.VAT, rate: 0 },
      {
        code: 'WHT_IND_1',
        name: 'WHT Individual 1% (40(2))',
        type: TaxType.WHT_INDIVIDUAL,
        rate: 1,
        whtIncomeType: WhtIncomeType.TYPE_40_2,
      },
      {
        code: 'WHT_IND_3',
        name: 'WHT Individual 3% (40(8))',
        type: TaxType.WHT_INDIVIDUAL,
        rate: 3,
        whtIncomeType: WhtIncomeType.TYPE_40_8,
      },
      {
        code: 'WHT_JUR_1',
        name: 'WHT Juristic 1% (Service)',
        type: TaxType.WHT_JURISTIC,
        rate: 1,
        whtIncomeType: WhtIncomeType.TYPE_40_8,
      },
      {
        code: 'WHT_JUR_3',
        name: 'WHT Juristic 3% (Professional)',
        type: TaxType.WHT_JURISTIC,
        rate: 3,
        whtIncomeType: WhtIncomeType.TYPE_40_3,
      },
      {
        code: 'WHT_JUR_5',
        name: 'WHT Juristic 5% (Rental)',
        type: TaxType.WHT_JURISTIC,
        rate: 5,
        whtIncomeType: WhtIncomeType.TYPE_40_5,
      },
    ];

    const results: Array<{ code: string; action: string }> = [];

    for (const def of defaults) {
      const existing = await this.prisma.taxRate.findFirst({
        where: { tenantId, code: def.code },
      });

      if (!existing) {
        await this.prisma.taxRate.create({
          data: { tenantId, isActive: true, isDefault: false, ...def },
        });
        results.push({ code: def.code, action: 'created' });
      } else {
        results.push({ code: def.code, action: 'skipped' });
      }
    }

    this.logger.log(
      `Seeded default tax rates for tenant ${tenantId}: ${results.map((r) => r.code).join(', ')}`,
    );
    return results;
  }
}
