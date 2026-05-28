import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCostCategoryDto,
  CreateCostVendorDto,
  CreateMarketingCampaignDto,
  CreateOperatingExpenseDto,
  ListExpensesQueryDto,
  OpBillingCycleDto,
  OpCostBehaviorDto,
  OpExpenseTypeDto,
  PnLQueryDto,
  SummaryQueryDto,
  TrendQueryDto,
  UpdateCostCategoryDto,
  UpdateCostVendorDto,
  UpdateMarketingCampaignDto,
  UpdateOperatingExpenseDto,
  UpsertCostBudgetDto,
} from './dto/operating-costs.dto';

interface MonthlyAmountInput {
  amount: number;
  type: OpExpenseTypeDto;
  billingCycle?: OpBillingCycleDto | null;
  startDate: Date;
  endDate?: Date | null;
}

/**
 * Operating Costs Service
 * - CRUD: categories / vendors / expenses / budgets / marketing campaigns
 * - Reports: summary / trend / P&L / CAC
 * - Snapshots: pre-compute monthly amounts for fast reporting
 */
@Injectable()
export class OperatingCostsService {
  private readonly logger = new Logger(OperatingCostsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ════════ Categories ════════

  async listCategories() {
    return this.prisma.opCostCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(dto: CreateCostCategoryDto) {
    const existing = await this.prisma.opCostCategory.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException(`Category code "${dto.code}" already exists`);
    return this.prisma.opCostCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateCostCategoryDto) {
    await this.ensureCategoryExists(id);
    return this.prisma.opCostCategory.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string) {
    await this.ensureCategoryExists(id);
    // Soft block: can't delete if has expenses or vendors
    const [expenseCount, vendorCount] = await Promise.all([
      this.prisma.opOperatingExpense.count({ where: { categoryId: id } }),
      this.prisma.opCostVendor.count({ where: { categoryId: id } }),
    ]);
    if (expenseCount > 0 || vendorCount > 0) {
      throw new ConflictException(
        `ไม่สามารถลบหมวดได้ — มี ${expenseCount} expenses และ ${vendorCount} vendors ผูกอยู่`,
      );
    }
    return this.prisma.opCostCategory.delete({ where: { id } });
  }

  private async ensureCategoryExists(id: string) {
    const cat = await this.prisma.opCostCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException(`Category ${id} not found`);
    return cat;
  }

  // ════════ Vendors ════════

  async listVendors(categoryId?: string) {
    return this.prisma.opCostVendor.findMany({
      where: categoryId ? { categoryId } : undefined,
      include: { category: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async getVendor(id: string) {
    const vendor = await this.prisma.opCostVendor.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!vendor) throw new NotFoundException(`Vendor ${id} not found`);
    return vendor;
  }

  async createVendor(dto: CreateCostVendorDto) {
    if (dto.categoryId) await this.ensureCategoryExists(dto.categoryId);
    return this.prisma.opCostVendor.create({ data: dto });
  }

  async updateVendor(id: string, dto: UpdateCostVendorDto) {
    await this.getVendor(id);
    if (dto.categoryId) await this.ensureCategoryExists(dto.categoryId);
    return this.prisma.opCostVendor.update({ where: { id }, data: dto });
  }

  async deleteVendor(id: string) {
    await this.getVendor(id);
    const count = await this.prisma.opOperatingExpense.count({ where: { vendorId: id } });
    if (count > 0) {
      throw new ConflictException(`ไม่สามารถลบ vendor ได้ — มี ${count} expenses ผูกอยู่`);
    }
    return this.prisma.opCostVendor.delete({ where: { id } });
  }

  // ════════ Expenses ════════

  async listExpenses(q: ListExpensesQueryDto) {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(200, q.limit || 20);
    const where: any = {};
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.type) where.type = q.type;
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search } },
        { description: { contains: q.search } },
        { reference: { contains: q.search } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.opOperatingExpense.findMany({
        where,
        include: { category: true, vendor: true },
        orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.opOperatingExpense.count({ where }),
    ]);

    return { data: items, total, page, limit };
  }

  async getExpense(id: string) {
    const expense = await this.prisma.opOperatingExpense.findUnique({
      where: { id },
      include: { category: true, vendor: true, snapshots: true },
    });
    if (!expense) throw new NotFoundException(`Expense ${id} not found`);
    return expense;
  }

  async createExpense(dto: CreateOperatingExpenseDto, userId?: string) {
    await this.ensureCategoryExists(dto.categoryId);
    if (dto.vendorId) await this.getVendor(dto.vendorId);
    if (dto.type === OpExpenseTypeDto.RECURRING && !dto.billingCycle) {
      throw new BadRequestException('billingCycle is required for RECURRING expenses');
    }

    const expense = await this.prisma.opOperatingExpense.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        createdBy: userId,
      },
    });

    // Regenerate snapshots for the affected months
    await this.regenerateSnapshotsForExpense(expense.id).catch((e) =>
      this.logger.warn(`snapshot regen failed for ${expense.id}: ${e.message}`),
    );
    return expense;
  }

  async updateExpense(id: string, dto: UpdateOperatingExpenseDto) {
    await this.getExpense(id);
    if (dto.categoryId) await this.ensureCategoryExists(dto.categoryId);
    if (dto.vendorId) await this.getVendor(dto.vendorId);

    const updated = await this.prisma.opOperatingExpense.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
      },
    });

    await this.regenerateSnapshotsForExpense(id).catch((e) =>
      this.logger.warn(`snapshot regen failed for ${id}: ${e.message}`),
    );
    return updated;
  }

  async deleteExpense(id: string) {
    await this.getExpense(id);
    return this.prisma.opOperatingExpense.delete({ where: { id } });
  }

  // ════════ Reports — Summary / Trend / P&L ════════

  /**
   * สรุปต้นทุนของ "เดือนนี้" หรือเดือนที่ระบุ
   * Returns: totalMonthly, byCategory, topVendors, recurringVsOneTime
   */
  async getSummary(q: SummaryQueryDto) {
    const now = new Date();
    const year = q.year || now.getFullYear();
    const month = q.month || now.getMonth() + 1;

    const snapshots = await this.prisma.opExpenseMonthlySnapshot.findMany({
      where: { year, month },
      include: { expense: { include: { category: true, vendor: true } } },
    });

    const total = snapshots.reduce((s, x) => s + Number(x.amountForMonth), 0);

    // by category
    const catMap = new Map<string, { categoryId: string; code: string; name: string; total: number; count: number }>();
    snapshots.forEach((s) => {
      const cat = s.expense.category;
      const key = cat.id;
      const cur = catMap.get(key) || {
        categoryId: cat.id,
        code: cat.code,
        name: cat.name,
        total: 0,
        count: 0,
      };
      cur.total += Number(s.amountForMonth);
      cur.count += 1;
      catMap.set(key, cur);
    });

    // top vendors
    const vendorMap = new Map<string, { vendorId: string; name: string; total: number; count: number }>();
    snapshots.forEach((s) => {
      const v = s.expense.vendor;
      if (!v) return;
      const cur = vendorMap.get(v.id) || { vendorId: v.id, name: v.name, total: 0, count: 0 };
      cur.total += Number(s.amountForMonth);
      cur.count += 1;
      vendorMap.set(v.id, cur);
    });

    // recurring vs one-time
    const recurringTotal = snapshots
      .filter((s) => s.expense.type === 'RECURRING')
      .reduce((s, x) => s + Number(x.amountForMonth), 0);
    const oneTimeTotal = snapshots
      .filter((s) => s.expense.type === 'ONE_TIME')
      .reduce((s, x) => s + Number(x.amountForMonth), 0);
    const usageTotal = snapshots
      .filter((s) => s.expense.type === 'USAGE')
      .reduce((s, x) => s + Number(x.amountForMonth), 0);

    return {
      period: { year, month },
      totalMonthly: round2(total),
      byCategory: Array.from(catMap.values())
        .map((c) => ({ ...c, total: round2(c.total) }))
        .sort((a, b) => b.total - a.total),
      topVendors: Array.from(vendorMap.values())
        .map((v) => ({ ...v, total: round2(v.total) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10),
      breakdown: {
        recurring: round2(recurringTotal),
        oneTime: round2(oneTimeTotal),
        usage: round2(usageTotal),
      },
    };
  }

  /**
   * 12-month trend ของต้นทุนรวม
   */
  async getTrend(q: TrendQueryDto) {
    const months = q.months || 12;
    const now = new Date();
    const points: Array<{ year: number; month: number; total: number; byCategory: Record<string, number> }> = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const snapshots = await this.prisma.opExpenseMonthlySnapshot.findMany({
        where: { year, month },
        select: { amountForMonth: true, categoryCode: true },
      });
      const total = snapshots.reduce((s, x) => s + Number(x.amountForMonth), 0);
      const byCategory: Record<string, number> = {};
      snapshots.forEach((s) => {
        byCategory[s.categoryCode] = (byCategory[s.categoryCode] || 0) + Number(s.amountForMonth);
      });
      Object.keys(byCategory).forEach((k) => (byCategory[k] = round2(byCategory[k])));
      points.push({ year, month, total: round2(total), byCategory });
    }
    return points;
  }

  /**
   * P&L (Profit & Loss) แบบง่าย
   * Revenue = MRR ที่คำนวณจาก subscriptions
   * Costs   = COGS + OpEx (ทั้งหมด)
   */
  async getPnL(q: PnLQueryDto) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getFullYear(), to.getMonth(), 1);

    // หา snapshots ในช่วง
    const snapshots = await this.prisma.opExpenseMonthlySnapshot.findMany({
      where: {
        OR: yearMonthRange(from, to).map(({ year, month }) => ({ year, month })),
      },
      select: {
        amountForMonth: true,
        categoryCode: true,
        isCogs: true,
        behavior: true,
      },
    });

    const cogs = snapshots.filter((s) => s.isCogs).reduce((s, x) => s + Number(x.amountForMonth), 0);
    const opex = snapshots.filter((s) => !s.isCogs).reduce((s, x) => s + Number(x.amountForMonth), 0);
    const marketing = snapshots
      .filter((s) => s.categoryCode === 'marketing')
      .reduce((s, x) => s + Number(x.amountForMonth), 0);
    const totalCosts = cogs + opex;

    // MRR ของช่วง (cumulative MRR — ประมาณการ)
    const monthsCount = monthsBetween(from, to) + 1;
    const currentMrr = await this.estimateCurrentMrr();
    const revenue = currentMrr * monthsCount;

    const grossProfit = revenue - cogs;
    const grossMargin = revenue > 0 ? grossProfit / revenue : 0;
    const operatingProfit = revenue - totalCosts;
    const operatingMargin = revenue > 0 ? operatingProfit / revenue : 0;

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), months: monthsCount },
      revenue: { mrr: round2(currentMrr), total: round2(revenue) },
      costs: {
        cogs: round2(cogs),
        opex: round2(opex),
        marketing: round2(marketing),
        total: round2(totalCosts),
      },
      grossProfit: round2(grossProfit),
      grossMargin: round4(grossMargin),
      operatingProfit: round2(operatingProfit),
      operatingMargin: round4(operatingMargin),
      netProfit: round2(operatingProfit),
    };
  }

  // ════════ CAC ════════

  /**
   * CAC = sum(marketing spend in period) / new tenants/subs in period
   */
  async getCac(from?: string, to?: string) {
    const periodEnd = to ? new Date(to) : new Date();
    const periodStart = from ? new Date(from) : new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 11, 1);

    // Marketing spend จาก OpMarketingCampaign + จาก expenses category=marketing
    const campaigns = await this.prisma.opMarketingCampaign.findMany({
      where: {
        startDate: { lte: periodEnd },
        OR: [{ endDate: null }, { endDate: { gte: periodStart } }],
      },
    });
    const campaignSpend = campaigns.reduce((s, c) => s + Number(c.totalSpend), 0);
    const attributedTenants = campaigns.reduce((s, c) => s + c.attributedTenants, 0);

    // Marketing expenses snapshots
    const marketingSnapshots = await this.prisma.opExpenseMonthlySnapshot.findMany({
      where: {
        categoryCode: 'marketing',
        OR: yearMonthRange(periodStart, periodEnd).map(({ year, month }) => ({ year, month })),
      },
      select: { amountForMonth: true },
    });
    const expenseSpend = marketingSnapshots.reduce((s, x) => s + Number(x.amountForMonth), 0);

    const totalSpend = campaignSpend + expenseSpend;

    // New subscriptions in period
    const newCustomers = await this.prisma.subscriptions.count({
      where: {
        created_at: { gte: periodStart, lte: periodEnd },
        status: { in: ['active', 'trial'] as any },
      },
    });

    // ใช้ attributed ก่อน ถ้าไม่มีก็ใช้ total new customers
    const denominator = attributedTenants > 0 ? attributedTenants : newCustomers;
    const cac = denominator > 0 ? totalSpend / denominator : 0;

    // LTV ประมาณการ (avg MRR × 24 เดือน — สมมุติ retention)
    const avgMrr = (await this.estimateCurrentMrr()) / Math.max(1, await this.countActiveSubs());
    const estimatedLtv = avgMrr * 24;
    const ltvToCac = cac > 0 ? estimatedLtv / cac : 0;
    const paybackMonths = avgMrr > 0 ? cac / avgMrr : 0;

    return {
      period: { from: periodStart.toISOString().slice(0, 10), to: periodEnd.toISOString().slice(0, 10) },
      totalMarketingSpend: round2(totalSpend),
      breakdown: {
        campaignSpend: round2(campaignSpend),
        expenseSpend: round2(expenseSpend),
      },
      newCustomers,
      attributedTenants,
      cac: round2(cac),
      estimatedLtv: round2(estimatedLtv),
      ltvToCac: round4(ltvToCac),
      paybackMonths: round2(paybackMonths),
    };
  }

  // ════════ Budgets ════════

  async listBudgets(year?: number) {
    const where = year ? { year } : undefined;
    return this.prisma.opCostBudget.findMany({
      where,
      include: { category: true },
      orderBy: [{ year: 'desc' }, { month: 'asc' }],
    });
  }

  /**
   * Budget vs Actual comparison สำหรับเดือนที่ระบุ
   * - ดึง budgets ของเดือนนั้น (ทั้ง monthly + annual ที่หารเฉลี่ย)
   * - ดึง actuals จาก snapshots
   * - คำนวณ variance + variance %
   */
  async getBudgetComparison(year: number, month: number) {
    // 1. ดึง budgets ของเดือนนั้น (monthly = month=N) + annual budget (month=null) แบ่ง 12
    const [monthlyBudgets, annualBudgets] = await Promise.all([
      this.prisma.opCostBudget.findMany({
        where: { year, month },
        include: { category: true },
      }),
      this.prisma.opCostBudget.findMany({
        where: { year, month: null },
        include: { category: true },
      }),
    ]);

    // Map categoryId(or 'all') → budget amount สำหรับเดือนนี้
    const budgetMap = new Map<string, { budget: number; isAnnual: boolean; notes?: string; budgetId?: string }>();
    monthlyBudgets.forEach((b) => {
      const key = b.categoryId || 'all';
      budgetMap.set(key, {
        budget: Number(b.budgetAmount),
        isAnnual: false,
        notes: b.notes || undefined,
        budgetId: b.id,
      });
    });
    annualBudgets.forEach((b) => {
      const key = b.categoryId || 'all';
      if (!budgetMap.has(key)) {
        // ใช้ annual ÷ 12 ถ้าไม่มี monthly budget
        budgetMap.set(key, {
          budget: Number(b.budgetAmount) / 12,
          isAnnual: true,
          notes: b.notes || undefined,
          budgetId: b.id,
        });
      }
    });

    // 2. ดึง actuals จาก snapshots ของเดือนนี้
    const snapshots = await this.prisma.opExpenseMonthlySnapshot.findMany({
      where: { year, month },
      include: { expense: { include: { category: true } } },
    });

    const actualMap = new Map<string, number>();
    let totalActual = 0;
    snapshots.forEach((s) => {
      const amount = Number(s.amountForMonth);
      totalActual += amount;
      const catId = s.expense.categoryId;
      actualMap.set(catId, (actualMap.get(catId) || 0) + amount);
    });

    // 3. รวมทุก categoryId ที่มี budget หรือ actual (union)
    const categories = await this.prisma.opCostCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const categoryRows = categories
      .map((cat) => {
        const b = budgetMap.get(cat.id);
        const actual = actualMap.get(cat.id) || 0;
        const budget = b?.budget || 0;
        const variance = actual - budget;
        const variancePercent = budget > 0 ? (variance / budget) * 100 : actual > 0 ? 100 : 0;
        return {
          categoryId: cat.id,
          code: cat.code,
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
          isCogs: cat.isCogs,
          budget: round2(budget),
          actual: round2(actual),
          variance: round2(variance),
          variancePercent: round2(variancePercent),
          remaining: round2(budget - actual),
          status: variance > 0 ? 'over' : variance === 0 ? 'on_track' : 'under',
          isAnnualBudget: b?.isAnnual || false,
          budgetId: b?.budgetId,
          notes: b?.notes,
        };
      })
      // เอาเฉพาะที่มี budget หรือ actual
      .filter((r) => r.budget > 0 || r.actual > 0);

    // 4. รวมยอดทั้งหมด (overall)
    const overallBudget = budgetMap.get('all');
    const totalBudgetFromAll = overallBudget?.budget || 0;
    const totalBudgetFromCategories = categoryRows.reduce((s, r) => s + r.budget, 0);
    const totalBudget = totalBudgetFromAll > 0 ? totalBudgetFromAll : totalBudgetFromCategories;
    const overallVariance = totalActual - totalBudget;
    const overallVariancePercent =
      totalBudget > 0 ? (overallVariance / totalBudget) * 100 : totalActual > 0 ? 100 : 0;

    return {
      period: { year, month },
      overall: {
        budget: round2(totalBudget),
        actual: round2(totalActual),
        variance: round2(overallVariance),
        variancePercent: round2(overallVariancePercent),
        remaining: round2(totalBudget - totalActual),
        status: overallVariance > 0 ? 'over' : overallVariance === 0 ? 'on_track' : 'under',
        budgetSource: totalBudgetFromAll > 0 ? 'overall' : 'sum_of_categories',
      },
      byCategory: categoryRows.sort((a, b) => b.budget - a.budget),
    };
  }

  async upsertBudget(dto: UpsertCostBudgetDto) {
    if (dto.categoryId) await this.ensureCategoryExists(dto.categoryId);
    return this.prisma.opCostBudget.upsert({
      where: {
        categoryId_year_month: {
          categoryId: dto.categoryId ?? null,
          year: dto.year,
          month: dto.month ?? null,
        },
      } as any,
      create: dto as any,
      update: { budgetAmount: dto.budgetAmount, notes: dto.notes ?? null },
    });
  }

  async deleteBudget(id: string) {
    return this.prisma.opCostBudget.delete({ where: { id } });
  }

  // ════════ Marketing Campaigns ════════

  async listCampaigns() {
    return this.prisma.opMarketingCampaign.findMany({
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    });
  }

  async createCampaign(dto: CreateMarketingCampaignDto) {
    return this.prisma.opMarketingCampaign.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
  }

  async updateCampaign(id: string, dto: UpdateMarketingCampaignDto) {
    const existing = await this.prisma.opMarketingCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Campaign ${id} not found`);
    return this.prisma.opMarketingCampaign.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
      },
    });
  }

  async deleteCampaign(id: string) {
    return this.prisma.opMarketingCampaign.delete({ where: { id } });
  }

  // ════════ Snapshots ════════

  /**
   * Regenerate snapshots for ALL active expenses for a given year+month
   * Used by background cron + manual trigger
   */
  async regenerateSnapshots(year: number, month: number) {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const expenses = await this.prisma.opOperatingExpense.findMany({
      where: {
        isActive: true,
        startDate: { lte: monthEnd },
        OR: [{ endDate: null }, { endDate: { gte: monthStart } }],
      },
      include: { category: true },
    });

    let created = 0;
    let updated = 0;

    for (const exp of expenses) {
      const amountForMonth = this.calculateMonthlyAmount(exp, year, month);
      if (amountForMonth <= 0) continue;

      const result = await this.prisma.opExpenseMonthlySnapshot.upsert({
        where: { expenseId_year_month: { expenseId: exp.id, year, month } },
        create: {
          expenseId: exp.id,
          year,
          month,
          amountForMonth: amountForMonth,
          categoryCode: exp.category.code,
          behavior: exp.behavior,
          isCogs: exp.category.isCogs,
        },
        update: {
          amountForMonth: amountForMonth,
          categoryCode: exp.category.code,
          behavior: exp.behavior,
          isCogs: exp.category.isCogs,
        },
      });
      if (result.createdAt.getTime() > Date.now() - 1000) created++;
      else updated++;
    }

    return { year, month, total: expenses.length, created, updated };
  }

  /** Regenerate snapshots for all months that an expense affects */
  async regenerateSnapshotsForExpense(expenseId: string) {
    const exp = await this.prisma.opOperatingExpense.findUnique({
      where: { id: expenseId },
      include: { category: true },
    });
    if (!exp) return;

    // ลบ snapshots เก่าก่อน
    await this.prisma.opExpenseMonthlySnapshot.deleteMany({ where: { expenseId } });

    if (!exp.isActive) return;

    const start = exp.startDate;
    const end = exp.endDate || new Date();
    const months = yearMonthRange(start, end);
    for (const ym of months) {
      const amount = this.calculateMonthlyAmount(exp, ym.year, ym.month);
      if (amount <= 0) continue;
      await this.prisma.opExpenseMonthlySnapshot.create({
        data: {
          expenseId,
          year: ym.year,
          month: ym.month,
          amountForMonth: amount,
          categoryCode: exp.category.code,
          behavior: exp.behavior,
          isCogs: exp.category.isCogs,
        },
      });
    }
  }

  /** คำนวณ amount ที่ตกในเดือนนั้น ๆ ตาม billing cycle */
  private calculateMonthlyAmount(
    exp: { amount: any; type: string; billingCycle: string | null; startDate: Date; endDate: Date | null },
    year: number,
    month: number,
  ): number {
    const amount = Number(exp.amount);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    // นอกช่วง active → 0
    if (exp.startDate > monthEnd) return 0;
    if (exp.endDate && exp.endDate < monthStart) return 0;

    if (exp.type === 'ONE_TIME') {
      // ตกเฉพาะเดือน startDate
      if (
        exp.startDate.getFullYear() === year &&
        exp.startDate.getMonth() + 1 === month
      ) {
        return amount;
      }
      return 0;
    }

    if (exp.type === 'USAGE') {
      // USAGE — ต้องบันทึก manual ผ่าน upsert ตรง — ที่นี่ skip
      return 0;
    }

    // RECURRING
    if (exp.billingCycle === 'MONTHLY') return amount;
    if (exp.billingCycle === 'YEARLY') return amount / 12;
    if (exp.billingCycle === 'QUARTERLY') {
      // ตกในเดือนแรกของแต่ละไตรมาส (Jan/Apr/Jul/Oct = 1,4,7,10)
      const startQuarterMonth = ((exp.startDate.getMonth()) % 3); // ใช้เป็น offset
      const monthsSinceStart =
        (year - exp.startDate.getFullYear()) * 12 + (month - 1) - exp.startDate.getMonth();
      if (monthsSinceStart >= 0 && monthsSinceStart % 3 === 0) {
        return amount;
      }
      // หรือจะแบ่งเฉลี่ยตามเดือนก็ได้ (amount / 3) — เลือกแนวทาง "เฉลี่ย" เพื่อให้ trend นุ่ม
      return amount / 3;
    }
    return 0;
  }

  // ════════ Helpers ════════

  private async estimateCurrentMrr(): Promise<number> {
    // ใช้ subscription ที่ active อยู่ × normalized monthly price
    const subs = await this.prisma.subscriptions.findMany({
      where: { status: { in: ['active', 'trial'] as any } },
      select: {
        billing_cycle: true,
        plans_subscriptions_plan_idToplans: { select: { price_monthly: true, price_yearly: true } },
      },
    });
    let mrr = 0;
    for (const s of subs) {
      const plan = s.plans_subscriptions_plan_idToplans;
      if (!plan) continue;
      const monthly = Number(plan.price_monthly || 0);
      const yearly = Number(plan.price_yearly || 0);
      if (s.billing_cycle === 'yearly') mrr += yearly / 12;
      else mrr += monthly;
    }
    return mrr;
  }

  private async countActiveSubs(): Promise<number> {
    return this.prisma.subscriptions.count({
      where: { status: { in: ['active', 'trial'] as any } },
    });
  }
}

// ─── pure utility functions ───────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Inclusive list of {year, month} from start → end */
function yearMonthRange(start: Date, end: Date): Array<{ year: number; month: number }> {
  const result: Array<{ year: number; month: number }> = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const limit = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= limit) {
    result.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return result;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
