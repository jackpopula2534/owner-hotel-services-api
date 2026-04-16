import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreatePriceComparisonDto, SelectQuoteDto } from './dto';

interface ComparisonMatrixItem {
  itemId: string;
  itemName: string;
  itemSku: string;
  requestedQty: number;
  quotes: Array<{
    supplierId: string;
    supplierName: string;
    quoteId: string;
    unitPrice: number | Prisma.Decimal;
    discount: number | Prisma.Decimal;
    totalPrice: number | Prisma.Decimal;
    leadTimeDays?: number | null;
    isLowest: boolean;
  }>;
}

interface ComparisonSummary {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  totalAmount: number | Prisma.Decimal;
  deliveryDays?: number | null;
  paymentTerms?: string | null;
  isRecommended: boolean;
}

@Injectable()
export class PriceComparisonsService {
  private readonly logger = new Logger(PriceComparisonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getByPR(prId: string, tenantId: string): Promise<{
    comparison: unknown | null;
    quotes: unknown[];
    matrix: {
      items: ComparisonMatrixItem[];
      summary: ComparisonSummary[];
    };
  }> {
    // Get price comparison
    const comparison = await this.prisma.priceComparison.findUnique({
      where: {
        tenantId_purchaseRequisitionId: {
          tenantId,
          purchaseRequisitionId: prId,
        },
      },
      include: {
        purchaseRequisition: {
          select: {
            id: true,
            prNumber: true,
            status: true,
          },
        },
        selectedQuote: {
          select: {
            id: true,
            quoteNumber: true,
            supplierId: true,
          },
        },
      },
    });

    if (!comparison) {
      // Return empty result when no comparison exists yet (PR is still collecting quotes)
      const quotesOnly = await this.prisma.supplierQuote.findMany({
        where: { purchaseRequisitionId: prId, tenantId },
        include: {
          items: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
          supplier: { select: { id: true, name: true, code: true } },
        },
        orderBy: { totalAmount: 'asc' },
      });
      return {
        comparison: null,
        quotes: quotesOnly,
        matrix: { items: [], summary: [] },
      };
    }

    // Get all supplier quotes for this PR
    const quotes = await this.prisma.supplierQuote.findMany({
      where: {
        purchaseRequisitionId: prId,
        tenantId,
      },
      include: {
        items: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
        supplier: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Build comparison matrix
    const itemMap = new Map<string, ComparisonMatrixItem>();
    let lowestTotal = Number.MAX_SAFE_INTEGER;

    quotes.forEach((quote) => {
      const quoteTotal = Number(quote.totalAmount);
      if (quoteTotal < lowestTotal) {
        lowestTotal = quoteTotal;
      }

      quote.items.forEach((item) => {
        if (!itemMap.has(item.itemId)) {
          itemMap.set(item.itemId, {
            itemId: item.itemId,
            itemName: item.item?.name || 'Unknown',
            itemSku: item.item?.sku || '',
            requestedQty: item.quantity,
            quotes: [],
          });
        }

        const matrixItem = itemMap.get(item.itemId);
        if (matrixItem) {
          matrixItem.quotes.push({
            supplierId: quote.supplierId,
            supplierName: quote.supplier?.name || 'Unknown',
            quoteId: quote.id,
            unitPrice: item.unitPrice,
            discount: item.discount,
            totalPrice: item.totalPrice,
            leadTimeDays: item.leadTimeDays,
            isLowest: false, // Will be set below
          });
        }
      });
    });

    // Find lowest price for each item
    itemMap.forEach((item) => {
      let lowestItemPrice = Number.MAX_SAFE_INTEGER;
      item.quotes.forEach((quote) => {
        const price = Number(quote.totalPrice);
        if (price < lowestItemPrice) {
          lowestItemPrice = price;
        }
      });

      item.quotes.forEach((quote) => {
        quote.isLowest = Number(quote.totalPrice) === lowestItemPrice;
      });
    });

    // Build summary
    const summary: ComparisonSummary[] = quotes.map((quote) => ({
      quoteId: quote.id,
      supplierId: quote.supplierId,
      supplierName: quote.supplier?.name || 'Unknown',
      totalAmount: quote.totalAmount,
      deliveryDays: quote.deliveryDays,
      paymentTerms: quote.paymentTerms,
      isRecommended: Number(quote.totalAmount) === lowestTotal,
    }));

    this.logger.log(
      `Price comparison retrieved for PR ${prId} with ${quotes.length} quotes`,
    );

    return {
      comparison: {
        id: comparison.id,
        comparisonNumber: comparison.comparisonNumber,
        purchaseRequisitionId: comparison.purchaseRequisitionId,
        purchaseRequisition: comparison.purchaseRequisition,
        selectedQuoteId: comparison.selectedQuoteId,
        selectionReason: comparison.selectionReason,
        comparedBy: comparison.comparedBy,
        comparedAt: comparison.comparedAt,
        approvedBy: comparison.approvedBy,
        approvedAt: comparison.approvedAt,
        notes: comparison.notes,
        createdAt: comparison.createdAt,
        updatedAt: comparison.updatedAt,
      },
      quotes: quotes.map((q) => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        status: q.status,
        supplierId: q.supplierId,
        supplierName: q.supplier?.name,
        totalAmount: q.totalAmount,
        deliveryDays: q.deliveryDays,
        paymentTerms: q.paymentTerms,
      })),
      matrix: {
        items: Array.from(itemMap.values()),
        summary,
      },
    };
  }

  async create(
    dto: CreatePriceComparisonDto,
    userId: string,
    tenantId: string,
  ): Promise<any> {
    // Verify PR exists
    const pr = await this.prisma.purchaseRequisition.findUnique({
      where: { id: dto.purchaseRequisitionId },
    });

    if (!pr || pr.tenantId !== tenantId) {
      throw new NotFoundException('Purchase requisition not found');
    }

    // If comparison already exists, return it instead of throwing error
    const existing = await this.prisma.priceComparison.findUnique({
      where: {
        tenantId_purchaseRequisitionId: {
          tenantId,
          purchaseRequisitionId: dto.purchaseRequisitionId,
        },
      },
      include: {
        purchaseRequisition: {
          select: { id: true, prNumber: true, status: true },
        },
        selectedQuote: {
          select: { id: true, quoteNumber: true, supplierId: true },
        },
      },
    });

    if (existing) {
      this.logger.log(
        `Price comparison already exists for PR ${dto.purchaseRequisitionId}, updating existing`,
      );

      // Upsert: update existing comparison with new data
      const updateData: Record<string, unknown> = {};
      if (dto.selectedQuoteId !== undefined) {
        // Validate selected quote belongs to this PR
        if (dto.selectedQuoteId) {
          const selectedQuote = await this.prisma.supplierQuote.findUnique({
            where: { id: dto.selectedQuoteId },
          });
          if (
            !selectedQuote ||
            selectedQuote.purchaseRequisitionId !== dto.purchaseRequisitionId
          ) {
            throw new BadRequestException(
              'Selected quote does not belong to this PR',
            );
          }
        }
        updateData.selectedQuoteId = dto.selectedQuoteId;
      }
      if (dto.selectionReason !== undefined) {
        updateData.selectionReason = dto.selectionReason;
      }
      if (dto.notes !== undefined) {
        updateData.notes = dto.notes;
      }

      if (Object.keys(updateData).length > 0) {
        const updated = await this.prisma.priceComparison.update({
          where: { id: existing.id },
          data: updateData,
          include: {
            purchaseRequisition: {
              select: { id: true, prNumber: true, status: true },
            },
            selectedQuote: {
              select: { id: true, quoteNumber: true, supplierId: true },
            },
          },
        });
        return updated;
      }

      return existing;
    }

    // Verify quotes exist for this PR
    const quotes = await this.prisma.supplierQuote.findMany({
      where: {
        purchaseRequisitionId: dto.purchaseRequisitionId,
        tenantId,
      },
    });

    if (quotes.length === 0) {
      throw new BadRequestException(
        'No supplier quotes found for this PR. Create quotes first.',
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Generate comparison number
        const comparisonNumber = await this.generateDocNumber(
          tenantId,
          'PRICE_COMPARISON',
          'PC',
          tx,
        );

        // If selectedQuoteId provided, validate it
        if (dto.selectedQuoteId) {
          const selectedQuote = await tx.supplierQuote.findUnique({
            where: { id: dto.selectedQuoteId },
          });

          if (
            !selectedQuote ||
            selectedQuote.purchaseRequisitionId !== dto.purchaseRequisitionId
          ) {
            throw new BadRequestException(
              'Selected quote does not belong to this PR',
            );
          }
        }

        const comparison = await tx.priceComparison.create({
          data: {
            tenantId,
            purchaseRequisitionId: dto.purchaseRequisitionId,
            comparisonNumber,
            selectedQuoteId: dto.selectedQuoteId,
            selectionReason: dto.selectionReason,
            comparedBy: userId,
            notes: dto.notes,
          },
          include: {
            purchaseRequisition: {
              select: {
                id: true,
                prNumber: true,
                status: true,
              },
            },
            selectedQuote: {
              select: {
                id: true,
                quoteNumber: true,
                supplierId: true,
              },
            },
          },
        });

        this.logger.log(
          `Price comparison ${comparisonNumber} created for PR ${dto.purchaseRequisitionId}`,
        );

        return comparison;
      });

      return result;
    } catch (error) {
      this.logger.error(`Error creating price comparison: ${error}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to create price comparison');
    }
  }

  async selectQuote(
    id: string,
    dto: SelectQuoteDto,
    userId: string,
    tenantId: string,
  ): Promise<any> {
    const comparison = await this.prisma.priceComparison.findUnique({
      where: { id },
    });

    if (!comparison || comparison.tenantId !== tenantId) {
      throw new NotFoundException('Price comparison not found');
    }

    // Verify selected quote belongs to this comparison's PR
    const selectedQuote = await this.prisma.supplierQuote.findUnique({
      where: { id: dto.selectedQuoteId },
    });

    if (
      !selectedQuote ||
      selectedQuote.purchaseRequisitionId !== comparison.purchaseRequisitionId
    ) {
      throw new BadRequestException(
        'Selected quote does not belong to this comparison',
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Update comparison with selected quote
        const updated = await tx.priceComparison.update({
          where: { id },
          data: {
            selectedQuoteId: dto.selectedQuoteId,
            selectionReason: dto.selectionReason,
          },
          include: {
            purchaseRequisition: {
              select: {
                id: true,
                prNumber: true,
              },
            },
            selectedQuote: {
              select: {
                id: true,
                quoteNumber: true,
                supplierId: true,
              },
            },
          },
        });

        // Reset any previously selected/rejected quotes back to RECEIVED
        await tx.supplierQuote.updateMany({
          where: {
            purchaseRequisitionId: comparison.purchaseRequisitionId,
            status: { in: ['SELECTED', 'REJECTED'] },
            id: { not: dto.selectedQuoteId },
          },
          data: {
            status: 'RECEIVED',
            selectedAt: null,
            rejectedAt: null,
            rejectionReason: null,
          },
        });

        // Mark the selected quote as SELECTED
        await tx.supplierQuote.update({
          where: { id: dto.selectedQuoteId },
          data: {
            status: 'SELECTED',
            selectedAt: new Date(),
          },
        });

        // Reject other RECEIVED quotes for the same PR
        await tx.supplierQuote.updateMany({
          where: {
            purchaseRequisitionId: comparison.purchaseRequisitionId,
            status: 'RECEIVED',
            id: { not: dto.selectedQuoteId },
          },
          data: {
            status: 'REJECTED',
            rejectedAt: new Date(),
            rejectionReason: 'ไม่ผ่านการเทียบราคา — เลือกซัพพลายเออร์รายอื่น',
          },
        });

        // Update PR status
        await tx.purchaseRequisition.update({
          where: { id: comparison.purchaseRequisitionId },
          data: { status: 'QUOTES_RECEIVED' },
        });

        this.logger.log(
          `Quote ${dto.selectedQuoteId} selected in comparison ${id}. Other quotes rejected.`,
        );

        return updated;
      });

      return result;
    } catch (error) {
      this.logger.error(`Error selecting quote in comparison: ${error}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to select quote');
    }
  }

  async approve(id: string, userId: string, tenantId: string): Promise<any> {
    const comparison = await this.prisma.priceComparison.findUnique({
      where: { id },
      include: {
        purchaseRequisition: true,
        selectedQuote: true,
      },
    });

    if (!comparison || comparison.tenantId !== tenantId) {
      throw new NotFoundException('Price comparison not found');
    }

    if (!comparison.selectedQuoteId) {
      throw new BadRequestException(
        'Cannot approve comparison without selecting a quote',
      );
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Update comparison as approved
        const approved = await tx.priceComparison.update({
          where: { id },
          data: {
            approvedBy: userId,
            approvedAt: new Date(),
          },
          include: {
            purchaseRequisition: {
              select: {
                id: true,
                prNumber: true,
              },
            },
            selectedQuote: {
              select: {
                id: true,
                quoteNumber: true,
                supplierId: true,
              },
            },
          },
        });

        // Update PR status to COMPARING then auto-advance
        await tx.purchaseRequisition.update({
          where: { id: comparison.purchaseRequisitionId },
          data: { status: 'COMPARING' },
        });

        // If selected quote exists, we could auto-advance to next status
        // For now, just mark as COMPARING
        // The next status (e.g., CREATING_PO) would be handled by another workflow

        this.logger.log(
          `Price comparison ${comparison.comparisonNumber} approved for PR ${comparison.purchaseRequisitionId}`,
        );

        return approved;
      });

      return result;
    } catch (error) {
      this.logger.error(`Error approving price comparison: ${error}`);
      throw new BadRequestException('Failed to approve comparison');
    }
  }

  private async generateDocNumber(
    tenantId: string,
    docType: string,
    prefix: string,
    prismaTransaction: Prisma.TransactionClient,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await prismaTransaction.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix, yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    return `${prefix}-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
