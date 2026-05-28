import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCashDrawerDto } from './dto/create-cash-drawer.dto';
import { CreateCashTxnDto, CashTxnType } from './dto/create-cash-txn.dto';

interface TxnQuery {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class CashDrawersService {
  private readonly logger = new Logger(CashDrawersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, propertyId?: string, status?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;

    const data = await this.prisma.cashDrawer.findMany({
      where,
      orderBy: [{ propertyId: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        propertyId: true,
        name: true,
        code: true,
        openingBalance: true,
        currentBalance: true,
        status: true,
        openedBy: true,
        openedAt: true,
        closedBy: true,
        closedAt: true,
        countedAmount: true,
        variance: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const drawer = await this.prisma.cashDrawer.findFirst({
      where: { id, tenantId },
    });
    if (!drawer) throw new NotFoundException(`Cash drawer ${id} not found`);
    return drawer;
  }

  async create(dto: CreateCashDrawerDto, tenantId: string) {
    const existing = await this.prisma.cashDrawer.findFirst({
      where: { tenantId, propertyId: dto.propertyId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Cash drawer with code "${dto.code}" already exists in this property`);
    }

    const openingBalance = dto.openingBalance ?? 0;
    const drawer = await this.prisma.cashDrawer.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        code: dto.code,
        openingBalance,
        currentBalance: openingBalance,
        status: 'CLOSED',
      },
    });

    this.logger.log(`Cash drawer created: ${drawer.id} (${drawer.code})`);
    return drawer;
  }

  async open(id: string, tenantId: string, openedBy: string) {
    const drawer = await this.findOne(id, tenantId);

    if (drawer.status === 'OPEN') {
      throw new BadRequestException('Cash drawer is already open');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.cashDrawer.update({
        where: { id },
        data: {
          status: 'OPEN',
          openedBy,
          openedAt: new Date(),
          closedBy: null,
          closedAt: null,
          countedAmount: null,
          variance: null,
        },
      });

      // Create OPENING transaction
      await tx.cashTransaction.create({
        data: {
          drawerId: id,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: 'OPENING',
          description: 'เปิดลิ้นชักเงินสด',
          amount: Number(drawer.openingBalance),
          balance: Number(drawer.openingBalance),
          createdBy: openedBy,
        },
      });

      return d;
    });

    this.logger.log(`Cash drawer ${id} opened by ${openedBy}`);
    return updated;
  }

  async close(id: string, tenantId: string, closedBy: string, countedAmount: number) {
    const drawer = await this.findOne(id, tenantId);

    if (drawer.status !== 'OPEN') {
      throw new BadRequestException(`Cash drawer is not open (status: ${drawer.status})`);
    }

    const variance = countedAmount - Number(drawer.currentBalance);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Create CLOSING transaction
      await tx.cashTransaction.create({
        data: {
          drawerId: id,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: 'CLOSING',
          description: 'ปิดลิ้นชักเงินสด',
          amount: Number(drawer.currentBalance),
          balance: Number(drawer.currentBalance),
          createdBy: closedBy,
        },
      });

      const d = await tx.cashDrawer.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedBy,
          closedAt: new Date(),
          countedAmount,
          variance,
        },
      });

      return d;
    });

    this.logger.log(`Cash drawer ${id} closed by ${closedBy}, variance: ${variance}`);
    return updated;
  }

  async addTransaction(dto: CreateCashTxnDto, tenantId: string, createdBy: string) {
    const drawer = await this.findOne(dto.drawerId, tenantId);

    if (drawer.status !== 'OPEN') {
      throw new BadRequestException('Cash drawer must be OPEN to add transactions');
    }

    // For TRANSFER: validate destination drawer
    let destDrawer = null;
    if (dto.txnType === CashTxnType.TRANSFER) {
      if (!dto.toDrawerId) {
        throw new BadRequestException('toDrawerId is required for TRANSFER transactions');
      }
      destDrawer = await this.findOne(dto.toDrawerId, tenantId);
      if (destDrawer.status !== 'OPEN') {
        throw new BadRequestException('Destination cash drawer must be OPEN');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Determine balance impact
      let newSourceBalance = Number(drawer.currentBalance);

      if (dto.txnType === CashTxnType.RECEIPT || dto.txnType === CashTxnType.OPENING) {
        newSourceBalance += dto.amount;
      } else if (
        dto.txnType === CashTxnType.PAYMENT ||
        dto.txnType === CashTxnType.CLOSING ||
        dto.txnType === CashTxnType.TRANSFER
      ) {
        if (newSourceBalance < dto.amount) {
          throw new BadRequestException('Insufficient balance in cash drawer');
        }
        newSourceBalance -= dto.amount;
      } else if (dto.txnType === CashTxnType.ADJUSTMENT) {
        newSourceBalance += dto.amount; // can be negative via signed amount from outside
      }

      // Create source transaction
      const txn = await tx.cashTransaction.create({
        data: {
          drawerId: dto.drawerId,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: dto.txnType,
          description: dto.description,
          amount: dto.amount,
          balance: newSourceBalance,
          toDrawerId: dto.toDrawerId ?? null,
          sourceType: dto.sourceType ?? null,
          sourceId: dto.sourceId ?? null,
          reference: dto.reference ?? null,
          createdBy,
        },
      });

      // Update source drawer balance
      await tx.cashDrawer.update({
        where: { id: dto.drawerId },
        data: { currentBalance: newSourceBalance },
      });

      // For TRANSFER: credit destination drawer
      if (dto.txnType === CashTxnType.TRANSFER && destDrawer) {
        const newDestBalance = Number(destDrawer.currentBalance) + dto.amount;

        await tx.cashTransaction.create({
          data: {
            drawerId: dto.toDrawerId!,
            tenantId,
            propertyId: destDrawer.propertyId,
            txnType: 'RECEIPT',
            description: `รับโอนจาก ${drawer.code}: ${dto.description}`,
            amount: dto.amount,
            balance: newDestBalance,
            sourceType: 'TRANSFER',
            sourceId: dto.drawerId,
            reference: dto.reference ?? null,
            createdBy,
          },
        });

        await tx.cashDrawer.update({
          where: { id: dto.toDrawerId! },
          data: { currentBalance: newDestBalance },
        });
      }

      return txn;
    });

    this.logger.log(`Cash transaction created: ${result.id} type=${dto.txnType} amount=${dto.amount}`);
    return result;
  }

  async getTransactions(drawerId: string, tenantId: string, query: TxnQuery) {
    const { dateFrom, dateTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // Validate drawer belongs to tenant
    await this.findOne(drawerId, tenantId);

    const where: Record<string, unknown> = { drawerId, tenantId };
    if (dateFrom || dateTo) {
      where.txnDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.cashTransaction.count({ where }),
      this.prisma.cashTransaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }
}
