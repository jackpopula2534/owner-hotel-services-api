import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CostBudgetsService } from './cost-budgets.service';
import { CreateCostBudgetDto } from './dto/create-cost-budget.dto';
import { UpdateCostBudgetDto } from './dto/update-cost-budget.dto';

interface CopyBudgetDto {
  fromPeriod: string;
  toPeriod: string;
  propertyId: string;
}

@ApiTags('Cost Accounting - Cost Budgets')
@Controller({ path: 'cost-accounting/cost-budgets', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@ApiBearerAuth()
export class CostBudgetsController {
  constructor(private readonly costBudgetsService: CostBudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'List cost budgets' })
  @ApiResponse({ status: 200, description: 'Cost budgets retrieved successfully' })
  async findAll(
    @Req() req: any,
    @Query('propertyId') propertyId: string,
    @Query('period') period?: string,
  ): Promise<{ success: boolean; data: any[] }> {
    const budgets = await this.costBudgetsService.findAll(req.user.tenantId, propertyId, period);
    return {
      success: true,
      data: budgets,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cost budget by ID' })
  @ApiResponse({ status: 200, description: 'Cost budget retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Cost budget not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const budget = await this.costBudgetsService.findOne(id, req.user.tenantId);
    return {
      success: true,
      data: budget,
    };
  }

  @Get('vs-actual/:period')
  @ApiOperation({ summary: 'Get budget vs actual comparison for a period' })
  @ApiResponse({ status: 200, description: 'Budget vs actual data retrieved successfully' })
  async getBudgetVsActual(
    @Param('period') period: string,
    @Query('propertyId') propertyId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[] }> {
    const vsActual = await this.costBudgetsService.getBudgetVsActual(
      req.user.tenantId,
      propertyId,
      period,
    );
    return {
      success: true,
      data: vsActual,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a cost budget' })
  @ApiResponse({ status: 201, description: 'Cost budget created successfully' })
  async create(
    @Body() createCostBudgetDto: CreateCostBudgetDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const budget = await this.costBudgetsService.create(
      createCostBudgetDto,
      req.user.id,
      req.user.tenantId,
    );
    return {
      success: true,
      data: budget,
    };
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create multiple cost budgets in bulk' })
  @ApiResponse({ status: 201, description: 'Cost budgets created successfully' })
  async bulkCreate(
    @Body() createCostBudgetsDtos: CreateCostBudgetDto[],
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[] }> {
    const budgets = await this.costBudgetsService.bulkCreate(
      createCostBudgetsDtos,
      req.user.id,
      req.user.tenantId,
    );
    return {
      success: true,
      data: budgets,
    };
  }

  @Post('copy')
  @ApiOperation({ summary: 'Copy budgets from one period to another' })
  @ApiResponse({ status: 201, description: 'Budgets copied successfully' })
  async copyBudget(
    @Body() body: CopyBudgetDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[] }> {
    const budgets = await this.costBudgetsService.copyBudget(
      req.user.tenantId,
      body.propertyId,
      body.fromPeriod,
      body.toPeriod,
    );
    return {
      success: true,
      data: budgets,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a cost budget' })
  @ApiResponse({ status: 200, description: 'Cost budget updated successfully' })
  @ApiResponse({ status: 404, description: 'Cost budget not found' })
  async update(
    @Param('id') id: string,
    @Body() updateCostBudgetDto: UpdateCostBudgetDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const budget = await this.costBudgetsService.update(id, updateCostBudgetDto, req.user.tenantId);
    return {
      success: true,
      data: budget,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a cost budget' })
  @ApiResponse({ status: 204, description: 'Cost budget deleted successfully' })
  @ApiResponse({ status: 404, description: 'Cost budget not found' })
  async remove(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: null }> {
    await this.costBudgetsService.remove(id, req.user.tenantId);
    return {
      success: true,
      data: null,
    };
  }
}
