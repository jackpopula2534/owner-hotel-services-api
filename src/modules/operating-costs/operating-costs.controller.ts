import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { OperatingCostsService } from './operating-costs.service';
import { SnapshotScheduler } from './snapshot/snapshot.scheduler';
import {
  CreateCostCategoryDto,
  CreateCostVendorDto,
  CreateMarketingCampaignDto,
  CreateOperatingExpenseDto,
  ListExpensesQueryDto,
  PnLQueryDto,
  RegenerateSnapshotDto,
  SummaryQueryDto,
  TrendQueryDto,
  UpdateCostCategoryDto,
  UpdateCostVendorDto,
  UpdateMarketingCampaignDto,
  UpdateOperatingExpenseDto,
  UpsertCostBudgetDto,
} from './dto/operating-costs.dto';

@ApiTags('Admin - Operating Costs')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/operating-costs', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class OperatingCostsController {
  constructor(
    private readonly svc: OperatingCostsService,
    private readonly snapshotScheduler: SnapshotScheduler,
  ) {}

  // ─── Categories ────────────────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'รายการหมวดต้นทุน' })
  listCategories() {
    return this.svc.listCategories();
  }

  @Post('categories')
  @ApiOperation({ summary: 'สร้างหมวดต้นทุนใหม่' })
  createCategory(@Body() dto: CreateCostCategoryDto) {
    return this.svc.createCategory(dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'แก้ไขหมวดต้นทุน' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCostCategoryDto) {
    return this.svc.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'ลบหมวดต้นทุน (ห้ามมี expenses ผูกอยู่)' })
  deleteCategory(@Param('id') id: string) {
    return this.svc.deleteCategory(id);
  }

  // ─── Vendors ───────────────────────────────────────────────────────────

  @Get('vendors')
  @ApiOperation({ summary: 'รายการ vendor / ผู้ให้บริการ' })
  listVendors(@Query('categoryId') categoryId?: string) {
    return this.svc.listVendors(categoryId);
  }

  @Get('vendors/:id')
  @ApiOperation({ summary: 'รายละเอียด vendor' })
  getVendor(@Param('id') id: string) {
    return this.svc.getVendor(id);
  }

  @Post('vendors')
  @ApiOperation({ summary: 'เพิ่ม vendor' })
  createVendor(@Body() dto: CreateCostVendorDto) {
    return this.svc.createVendor(dto);
  }

  @Patch('vendors/:id')
  @ApiOperation({ summary: 'แก้ไข vendor' })
  updateVendor(@Param('id') id: string, @Body() dto: UpdateCostVendorDto) {
    return this.svc.updateVendor(id, dto);
  }

  @Delete('vendors/:id')
  @ApiOperation({ summary: 'ลบ vendor' })
  deleteVendor(@Param('id') id: string) {
    return this.svc.deleteVendor(id);
  }

  // ─── Expenses ──────────────────────────────────────────────────────────

  @Get('expenses')
  @ApiOperation({ summary: 'รายการต้นทุน (paginated)' })
  listExpenses(@Query() q: ListExpensesQueryDto) {
    return this.svc.listExpenses(q);
  }

  @Get('expenses/:id')
  @ApiOperation({ summary: 'รายละเอียดต้นทุน' })
  getExpense(@Param('id') id: string) {
    return this.svc.getExpense(id);
  }

  @Post('expenses')
  @ApiOperation({ summary: 'เพิ่มรายการต้นทุนใหม่' })
  createExpense(@Body() dto: CreateOperatingExpenseDto, @Req() req: any) {
    return this.svc.createExpense(dto, req.user?.id);
  }

  @Patch('expenses/:id')
  @ApiOperation({ summary: 'แก้ไขรายการต้นทุน' })
  updateExpense(@Param('id') id: string, @Body() dto: UpdateOperatingExpenseDto) {
    return this.svc.updateExpense(id, dto);
  }

  @Delete('expenses/:id')
  @ApiOperation({ summary: 'ลบรายการต้นทุน' })
  deleteExpense(@Param('id') id: string) {
    return this.svc.deleteExpense(id);
  }

  // ─── Reports ───────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({
    summary: 'สรุปต้นทุนรายเดือน (รวม + แยกหมวด + top vendors)',
  })
  getSummary(@Query() q: SummaryQueryDto) {
    return this.svc.getSummary(q);
  }

  @Get('trend')
  @ApiOperation({
    summary: 'Time-series ต้นทุนย้อนหลัง (default 12 เดือน)',
  })
  getTrend(@Query() q: TrendQueryDto) {
    return this.svc.getTrend(q);
  }

  @Get('pnl')
  @ApiOperation({
    summary: 'P&L (Revenue vs Costs) — Gross Margin / Operating Margin / Net Profit',
  })
  getPnL(@Query() q: PnLQueryDto) {
    return this.svc.getPnL(q);
  }

  @Get('cac')
  @ApiOperation({
    summary: 'CAC + LTV/CAC Ratio + Payback Months',
  })
  getCac(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.getCac(from, to);
  }

  // ─── Budgets ───────────────────────────────────────────────────────────

  @Get('budgets')
  @ApiOperation({ summary: 'งบประมาณ (filter ตามปี)' })
  listBudgets(@Query('year') year?: string) {
    return this.svc.listBudgets(year ? Number(year) : undefined);
  }

  @Get('budget-comparison')
  @ApiOperation({
    summary: 'Budget vs Actual — เทียบงบประมาณกับยอดจริงรายเดือน',
    description:
      'ดึง budget ของเดือนที่ระบุ (รองรับ monthly budget + annual budget ÷ 12) แล้วเทียบกับ actuals จาก snapshots',
  })
  getBudgetComparison(@Query() q: SummaryQueryDto) {
    const now = new Date();
    return this.svc.getBudgetComparison(q.year || now.getFullYear(), q.month || now.getMonth() + 1);
  }

  @Post('budgets')
  @ApiOperation({ summary: 'สร้างหรือแก้ไขงบประมาณ (upsert)' })
  upsertBudget(@Body() dto: UpsertCostBudgetDto) {
    return this.svc.upsertBudget(dto);
  }

  @Delete('budgets/:id')
  @ApiOperation({ summary: 'ลบงบประมาณ' })
  deleteBudget(@Param('id') id: string) {
    return this.svc.deleteBudget(id);
  }

  // ─── Marketing Campaigns ──────────────────────────────────────────────

  @Get('campaigns')
  @ApiOperation({ summary: 'รายการ marketing campaigns' })
  listCampaigns() {
    return this.svc.listCampaigns();
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'สร้าง campaign' })
  createCampaign(@Body() dto: CreateMarketingCampaignDto) {
    return this.svc.createCampaign(dto);
  }

  @Patch('campaigns/:id')
  @ApiOperation({ summary: 'แก้ไข campaign' })
  updateCampaign(@Param('id') id: string, @Body() dto: UpdateMarketingCampaignDto) {
    return this.svc.updateCampaign(id, dto);
  }

  @Delete('campaigns/:id')
  @ApiOperation({ summary: 'ลบ campaign' })
  deleteCampaign(@Param('id') id: string) {
    return this.svc.deleteCampaign(id);
  }

  // ─── Snapshots ─────────────────────────────────────────────────────────

  @Post('snapshots/regenerate')
  @ApiOperation({
    summary: '[Sync] Regenerate snapshots ทันทีในคำสั่งนี้ — สำหรับ debugging',
    description:
      'รัน synchronously ใน HTTP request นี้ ใช้เมื่อต้องการผลลัพธ์ทันที ' +
      'สำหรับการรันปกติให้ใช้ /snapshots/trigger (async via Bull queue)',
  })
  regenerateSnapshots(@Body() dto: RegenerateSnapshotDto) {
    const now = new Date();
    return this.svc.regenerateSnapshots(
      dto.year || now.getFullYear(),
      dto.month || now.getMonth() + 1,
    );
  }

  @Post('snapshots/trigger')
  @ApiOperation({
    summary: '[Async] Enqueue snapshot regeneration job (Bull queue)',
    description:
      'ใส่งานเข้า queue ให้ worker process รัน background — ไม่ block HTTP request. ' +
      'งานปกติทำอัตโนมัติทุกต้นเดือนเวลา 02:00 + ทุกวันเวลา 03:00 อยู่แล้ว',
  })
  async triggerSnapshot(@Body() dto: RegenerateSnapshotDto, @Req() req: any) {
    const now = new Date();
    const year = dto.year || now.getFullYear();
    const month = dto.month || now.getMonth() + 1;
    const job = await this.snapshotScheduler.enqueueManual(
      year,
      month,
      req.user?.email || req.user?.id || 'unknown-admin',
    );
    return {
      success: true,
      message: `Snapshot job queued for ${year}-${String(month).padStart(2, '0')}`,
      jobId: job.id,
      year,
      month,
    };
  }

  @Get('snapshots/queue-status')
  @ApiOperation({
    summary: 'สถานะของ snapshot queue (counts + recent jobs)',
    description: 'ดู waiting/active/completed/failed counts + 10 jobs ล่าสุด',
  })
  getSnapshotQueueStatus() {
    return this.snapshotScheduler.getQueueStatus();
  }
}
