import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAssetDto, DepreciationMethodEnum } from './dto/create-asset.dto';
import { QueryAssetDto } from './dto/query-asset.dto';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryAssetDto) {
    const { propertyId, category, status, search, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { assetCode: { contains: search } },
        { name: { contains: search } },
        { serialNo: { contains: search } },
        { location: { contains: search } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.fixedAsset.count({ where }),
      this.prisma.fixedAsset.findMany({
        where,
        orderBy: [{ category: 'asc' }, { assetCode: 'asc' }],
        skip,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, tenantId },
      include: {
        depreciations: {
          orderBy: { period: 'desc' },
          take: 12,
        },
      },
    });
    if (!asset) throw new NotFoundException(`Fixed asset ${id} not found`);
    return asset;
  }

  async create(dto: CreateAssetDto, tenantId: string, createdBy: string) {
    const existing = await this.prisma.fixedAsset.findFirst({
      where: { tenantId, propertyId: dto.propertyId, assetCode: dto.assetCode },
    });
    if (existing) throw new ConflictException(`Asset code ${dto.assetCode} already exists`);

    const purchaseCost = dto.purchaseCost;
    const acquisitionCost = dto.acquisitionCost ?? 0;
    const bookValue = purchaseCost + acquisitionCost;

    return this.prisma.fixedAsset.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        assetCode: dto.assetCode,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        costCenterId: dto.costCenterId,
        assetAccountId: dto.assetAccountId,
        accumDeprecAccountId: dto.accumDeprecAccountId,
        deprecExpenseAccountId: dto.deprecExpenseAccountId,
        purchaseDate: new Date(dto.purchaseDate),
        purchaseCost,
        acquisitionCost,
        residualValue: dto.residualValue ?? 0,
        usefulLifeYears: dto.usefulLifeYears,
        depreciationMethod: dto.depreciationMethod,
        depreciationRate: dto.depreciationRate,
        accumulatedDepreciation: 0,
        bookValue,
        status: 'ACTIVE',
        location: dto.location,
        serialNo: dto.serialNo,
        responsiblePerson: dto.responsiblePerson,
        purchaseOrderId: dto.purchaseOrderId,
        notes: dto.notes,
        createdBy,
      },
    });
  }

  async update(id: string, dto: Partial<CreateAssetDto>, tenantId: string) {
    await this.findOne(id, tenantId);
    const { purchaseCost: _, acquisitionCost: __, ...updateFields } = dto;
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        ...(updateFields.name && { name: updateFields.name }),
        ...(updateFields.description !== undefined && { description: updateFields.description }),
        ...(updateFields.location !== undefined && { location: updateFields.location }),
        ...(updateFields.serialNo !== undefined && { serialNo: updateFields.serialNo }),
        ...(updateFields.responsiblePerson !== undefined && {
          responsiblePerson: updateFields.responsiblePerson,
        }),
        ...(updateFields.notes !== undefined && { notes: updateFields.notes }),
        ...(updateFields.costCenterId !== undefined && { costCenterId: updateFields.costCenterId }),
      },
    });
  }

  async dispose(
    id: string,
    tenantId: string,
    disposedBy: string,
    disposalDate: string,
    disposalAmount: number,
    reason?: string,
  ) {
    const asset = await this.findOne(id, tenantId);
    if (asset.status === 'DISPOSED') throw new BadRequestException('Asset is already disposed');

    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposalDate: new Date(disposalDate),
        disposalAmount,
        disposedBy,
        disposalReason: reason,
      },
    });
  }

  async calculateDepreciation(id: string, tenantId: string) {
    const asset = await this.findOne(id, tenantId);
    if (asset.status !== 'ACTIVE') throw new BadRequestException('Asset is not active');
    if (asset.depreciationMethod === DepreciationMethodEnum.NO_DEPRECIATION) {
      return { amount: 0, message: 'No depreciation for this asset' };
    }

    const depreciableBase =
      Number(asset.purchaseCost) + Number(asset.acquisitionCost) - Number(asset.residualValue);
    let monthlyAmount = 0;

    switch (asset.depreciationMethod) {
      case DepreciationMethodEnum.STRAIGHT_LINE:
        monthlyAmount = depreciableBase / (asset.usefulLifeYears * 12);
        break;
      case DepreciationMethodEnum.DECLINING_BALANCE:
        const rate = asset.depreciationRate ? Number(asset.depreciationRate) / 100 : 0.2;
        monthlyAmount = (Number(asset.bookValue) * rate) / 12;
        break;
      default:
        monthlyAmount = depreciableBase / (asset.usefulLifeYears * 12);
    }

    return {
      assetId: id,
      assetCode: asset.assetCode,
      method: asset.depreciationMethod,
      bookValue: Number(asset.bookValue),
      depreciableBase,
      monthlyAmount: Math.round(monthlyAmount * 100) / 100,
      remainingMonths: Math.max(
        0,
        asset.usefulLifeYears * 12 -
          (await this.prisma.assetDepreciation.count({ where: { assetId: id } })),
      ),
    };
  }

  async getDepreciationSchedule(id: string, tenantId: string) {
    const asset = await this.findOne(id, tenantId);
    const totalMonths = asset.usefulLifeYears * 12;
    const depreciableBase =
      Number(asset.purchaseCost) + Number(asset.acquisitionCost) - Number(asset.residualValue);
    const monthlyAmount =
      asset.depreciationMethod !== DepreciationMethodEnum.NO_DEPRECIATION
        ? Math.round((depreciableBase / totalMonths) * 100) / 100
        : 0;

    const purchaseDate = new Date(asset.purchaseDate);
    const schedule = [];
    let accumulated = 0;
    let bookVal = Number(asset.purchaseCost) + Number(asset.acquisitionCost);

    for (let i = 0; i < totalMonths; i++) {
      const d = new Date(purchaseDate);
      d.setMonth(d.getMonth() + i + 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      accumulated += monthlyAmount;
      bookVal -= monthlyAmount;
      schedule.push({
        period,
        depreciationAmount: monthlyAmount,
        accumulatedDepreciation: Math.round(accumulated * 100) / 100,
        bookValue: Math.max(Number(asset.residualValue), Math.round(bookVal * 100) / 100),
      });
    }

    return { assetId: id, assetCode: asset.assetCode, totalMonths, monthlyAmount, schedule };
  }
}
