import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { InventoryLotStatus } from '@prisma/client';

@ApiTags('Inventory Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory/dashboard')
export class InventoryDashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Total value of lots expiring within next 30 days' })
  @Get('near-expiry-value')
  async getNearExpiryValue(@Request() req: any) {
    const today = new Date();
    const future = new Date();
    future.setDate(today.getDate() + 30);

    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        tenantId: req.user.tenantId,
        status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
        expiryDate: { gte: today, lte: future },
      },
      select: { remainingQty: true, unitCost: true, expiryDate: true },
    });

    const totalValue = lots.reduce(
      (sum, l) => sum + l.remainingQty * Number(l.unitCost),
      0,
    );

    return {
      totalValue,
      lotCount: lots.length,
      period: { from: today.toISOString(), to: future.toISOString() },
    };
  }

  @ApiOperation({ summary: 'Waste cost from expired lots last month' })
  @Get('expired-waste-last-month')
  async getExpiredWasteLastMonth(@Request() req: any) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const wasteMovements = await this.prisma.stockMovement.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: {
        tenantId: req.user.tenantId,
        type: 'WASTE',
        createdAt: { gte: from, lte: to },
        // `lot` relation filter added after last prisma generate — cast to any
        lot: { status: { in: ['DISPOSED', 'EXPIRED'] } },
      } as any,
      select: { quantity: true, unitCost: true, totalCost: true },
    });

    const totalWasteCost = wasteMovements.reduce(
      (sum, m) => sum + Number(m.totalCost),
      0,
    );

    return {
      totalWasteCost,
      movementCount: wasteMovements.length,
      period: { from: from.toISOString(), to: to.toISOString() },
    };
  }
}

@ApiTags('Inventory Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory/reports')
export class InventoryReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: 'Inventory valuation by lot (JSON or CSV)' })
  @ApiQuery({ name: 'format', enum: ['json', 'csv'], required: false })
  @Get('inventory-valuation-by-lot')
  async getValuationByLot(
    @Request() req: any,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Res() res: Response,
  ) {
    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        tenantId: req.user.tenantId,
        status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
      },
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { name: true, sku: true, unit: true } },
        warehouse: { select: { name: true } },
      },
    });

    const rows = lots.map((l) => ({
      lotNumber: l.lotNumber,
      itemName: l.item.name,
      sku: l.item.sku,
      warehouse: l.warehouse.name,
      remainingQty: l.remainingQty,
      unit: l.item.unit,
      unitCost: Number(l.unitCost),
      totalValue: l.remainingQty * Number(l.unitCost),
      expiryDate: l.expiryDate?.toISOString().split('T')[0] ?? '',
      status: l.status,
    }));

    if (format === 'csv') {
      const headers = Object.keys(rows[0] ?? {}).join(',');
      const lines = rows.map((r) => Object.values(r).join(','));
      const csv = [headers, ...lines].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="valuation-by-lot.csv"');
      return res.send(csv);
    }

    return res.json({ success: true, data: rows });
  }

  @ApiOperation({ summary: 'Expiry schedule — lots grouped by expiry week' })
  @Get('expiry-schedule')
  async getExpirySchedule(@Request() req: any) {
    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        tenantId: req.user.tenantId,
        status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
        expiryDate: { not: null },
      },
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
    });

    // Group by ISO week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grouped = (lots as any[]).reduce((acc: Record<string, any[]>, lot: any) => {
      if (!lot.expiryDate) return acc;
      const weekKey = getISOWeek(lot.expiryDate);
      acc[weekKey] = acc[weekKey] ?? [];
      acc[weekKey].push(lot);
      return acc;
    }, {} as Record<string, any[]>);

    return { data: grouped };
  }
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `${d.getFullYear()}-W${String(Math.ceil(((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
