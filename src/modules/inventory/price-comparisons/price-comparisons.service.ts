import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { AuditAction, AuditCategory, AuditResource } from '@/audit-log/dto/audit-log.dto';
import { NotificationsService } from '@/notifications/notifications.service';
import { CreatePriceComparisonDto, SelectQuoteDto, RejectComparisonDto } from './dto';

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

/**
 * Approval workflow status of the price comparison.
 *
 * The values mirror the Prisma `PriceComparisonStatus` enum. We mirror them
 * locally as a string-literal union so this service remains type-safe even
 * before `prisma generate` has been run against the new migration.
 */
type PriceComparisonStatusLiteral = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

@Injectable()
export class PriceComparisonsService {
  private readonly logger = new Logger(PriceComparisonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getByPR(
    prId: string,
    tenantId: string,
  ): Promise<{
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

    this.logger.log(`Price comparison retrieved for PR ${prId} with ${quotes.length} quotes`);

    const comparisonRow = comparison as unknown as Record<string, unknown>;
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
        status: comparisonRow.status,
        submittedAt: comparisonRow.submittedAt,
        rejectedBy: comparisonRow.rejectedBy,
        rejectedAt: comparisonRow.rejectedAt,
        rejectionReason: comparisonRow.rejectionReason,
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

  async create(dto: CreatePriceComparisonDto, userId: string, tenantId: string): Promise<unknown> {
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
          if (!selectedQuote || selectedQuote.purchaseRequisitionId !== dto.purchaseRequisitionId) {
            throw new BadRequestException('Selected quote does not belong to this PR');
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
      throw new BadRequestException('No supplier quotes found for this PR. Create quotes first.');
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

          if (!selectedQuote || selectedQuote.purchaseRequisitionId !== dto.purchaseRequisitionId) {
            throw new BadRequestException('Selected quote does not belong to this PR');
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
      this.logger.error(`Error creating price comparison: ${String(error)}`);
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
  ): Promise<unknown> {
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
      throw new BadRequestException('Selected quote does not belong to this comparison');
    }

    let result: unknown;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Update comparison with selected quote and submit for approval.
        // Reselect after a rejection clears prior rejection metadata so the
        // comparison goes back into PENDING_APPROVAL cleanly.
        const updated = await tx.priceComparison.update({
          where: { id },
          data: {
            selectedQuoteId: dto.selectedQuoteId,
            selectionReason: dto.selectionReason,
            status: 'PENDING_APPROVAL',
            submittedAt: new Date(),
            rejectedBy: null,
            rejectedAt: null,
            rejectionReason: null,
          } as unknown as Prisma.PriceComparisonUncheckedUpdateInput,
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
    } catch (error) {
      this.logger.error(`Error selecting quote in comparison: ${String(error)}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to select quote');
    }

    await this.notifyAndAuditSubmission(
      { id: comparison.id, comparisonNumber: comparison.comparisonNumber },
      userId,
      tenantId,
    );

    return result;
  }

  async approve(id: string, userId: string, tenantId: string): Promise<unknown> {
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
      throw new BadRequestException('Cannot approve comparison without selecting a quote');
    }

    const currentStatus = (comparison as unknown as { status?: PriceComparisonStatusLiteral })
      .status;
    if (currentStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException('ใบเทียบราคาไม่อยู่ในสถานะรออนุมัติ');
    }

    let result: unknown;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const approved = await tx.priceComparison.update({
          where: { id },
          data: {
            approvedBy: userId,
            approvedAt: new Date(),
            status: 'APPROVED',
          } as unknown as Prisma.PriceComparisonUncheckedUpdateInput,
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

        this.logger.log(
          `Price comparison ${comparison.comparisonNumber} approved for PR ${comparison.purchaseRequisitionId}`,
        );

        return approved;
      });
    } catch (error) {
      this.logger.error(`Error approving price comparison: ${String(error)}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to approve comparison');
    }

    await this.notifyAndAuditApproval(
      {
        id: comparison.id,
        comparisonNumber: comparison.comparisonNumber,
        comparedBy: comparison.comparedBy,
      },
      userId,
      tenantId,
    );

    return result;
  }

  async reject(
    id: string,
    dto: RejectComparisonDto,
    userId: string,
    tenantId: string,
  ): Promise<unknown> {
    const comparison = await this.prisma.priceComparison.findUnique({
      where: { id },
    });

    if (!comparison || comparison.tenantId !== tenantId) {
      throw new NotFoundException('Price comparison not found');
    }

    const currentStatus = (comparison as unknown as { status?: PriceComparisonStatusLiteral })
      .status;
    if (currentStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException('ใบเทียบราคาไม่อยู่ในสถานะรออนุมัติ');
    }

    let result: unknown;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const rejected = await tx.priceComparison.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectedBy: userId,
            rejectedAt: new Date(),
            rejectionReason: dto.rejectionReason,
          } as unknown as Prisma.PriceComparisonUncheckedUpdateInput,
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

        this.logger.log(`Price comparison ${comparison.comparisonNumber} rejected by ${userId}`);

        return rejected;
      });
    } catch (error) {
      this.logger.error(`Error rejecting price comparison: ${String(error)}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to reject comparison');
    }

    await this.notifyAndAuditRejection(
      {
        id: comparison.id,
        comparisonNumber: comparison.comparisonNumber,
        comparedBy: comparison.comparedBy,
      },
      dto.rejectionReason,
      userId,
      tenantId,
    );

    return result;
  }

  async findPendingApprovals(tenantId: string): Promise<unknown[]> {
    return this.prisma.priceComparison.findMany({
      where: {
        tenantId,
        status: 'PENDING_APPROVAL',
      } as unknown as Prisma.PriceComparisonWhereInput,
      include: {
        selectedQuote: {
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        purchaseRequisition: {
          select: {
            id: true,
            prNumber: true,
            status: true,
            requestedBy: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        submittedAt: 'desc',
      } as unknown as Prisma.PriceComparisonOrderByWithRelationInput,
    });
  }

  private async notifyAndAuditSubmission(
    row: { id: string; comparisonNumber: string },
    userId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.auditLogService.log({
        action: AuditAction.PRICE_COMPARISON_SUBMITTED,
        resource: AuditResource.PRICE_COMPARISON,
        resourceId: row.id,
        category: AuditCategory.PROCUREMENT,
        tenantId,
        userId,
        description: `ส่ง ${row.comparisonNumber} เพื่อขออนุมัติ`,
      });
    } catch (error) {
      this.logger.warn(
        `Audit log failed for price comparison submission ${row.id}: ${String(error)}`,
      );
    }

    try {
      const managers = await this.prisma.user.findMany({
        where: { tenantId, role: 'procurement_manager' },
        select: { id: true },
      });

      await Promise.all(
        managers.map((manager) =>
          this.notificationsService.create({
            userId: manager.id,
            tenantId,
            title: 'ใบเทียบราคารออนุมัติ',
            message: `มีใบเทียบราคา ${row.comparisonNumber} รออนุมัติ`,
            type: 'price_comparison_pending_approval',
            category: 'procurement',
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(`Notify managers failed for price comparison ${row.id}: ${String(error)}`);
    }
  }

  private async notifyAndAuditApproval(
    row: { id: string; comparisonNumber: string; comparedBy: string },
    userId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.auditLogService.log({
        action: AuditAction.PRICE_COMPARISON_APPROVED,
        resource: AuditResource.PRICE_COMPARISON,
        resourceId: row.id,
        category: AuditCategory.PROCUREMENT,
        tenantId,
        userId,
        description: `อนุมัติใบเทียบราคา ${row.comparisonNumber}`,
      });
    } catch (error) {
      this.logger.warn(
        `Audit log failed for price comparison approval ${row.id}: ${String(error)}`,
      );
    }

    try {
      await this.notificationsService.create({
        userId: row.comparedBy,
        tenantId,
        title: 'ใบเทียบราคาได้รับอนุมัติ',
        message: `ใบเทียบราคา ${row.comparisonNumber} ได้รับอนุมัติแล้ว — สร้าง PO ได้`,
        type: 'price_comparison_approved',
        category: 'procurement',
      });
    } catch (error) {
      this.logger.warn(`Notify buyer failed for price comparison ${row.id}: ${String(error)}`);
    }
  }

  private async notifyAndAuditRejection(
    row: { id: string; comparisonNumber: string; comparedBy: string },
    rejectionReason: string,
    userId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.auditLogService.log({
        action: AuditAction.PRICE_COMPARISON_REJECTED,
        resource: AuditResource.PRICE_COMPARISON,
        resourceId: row.id,
        category: AuditCategory.PROCUREMENT,
        tenantId,
        userId,
        newValues: { rejectionReason },
        description: `ปฏิเสธใบเทียบราคา ${row.comparisonNumber}`,
      });
    } catch (error) {
      this.logger.warn(
        `Audit log failed for price comparison rejection ${row.id}: ${String(error)}`,
      );
    }

    try {
      await this.notificationsService.create({
        userId: row.comparedBy,
        tenantId,
        title: 'ใบเทียบราคาถูกปฏิเสธ',
        message: `ใบเทียบราคา ${row.comparisonNumber} ถูกปฏิเสธ: ${rejectionReason}`,
        type: 'price_comparison_rejected',
        category: 'procurement',
      });
    } catch (error) {
      this.logger.warn(
        `Notify buyer failed for price comparison rejection ${row.id}: ${String(error)}`,
      );
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
