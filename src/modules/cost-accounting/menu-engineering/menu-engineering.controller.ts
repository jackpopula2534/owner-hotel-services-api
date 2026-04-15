import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MenuEngineeringService } from './menu-engineering.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

interface SnapshotResponse {
  id: string;
  tenantId: string;
  propertyId: string;
  restaurantId?: string;
  period: string;
  snapshotDate: Date;
  avgPopularity: number;
  avgMargin: number;
  totalItems: number;
  starsCount: number;
  plowhorsesCount: number;
  puzzlesCount: number;
  dogsCount: number;
  createdBy: string;
  createdAt: Date;
  items?: Array<{
    id: string;
    menuItemName: string;
    categoryName?: string;
    quantitySold: number;
    marginPercent: number;
    classification: string;
    recommendation?: string;
    totalProfit: number;
  }>;
}

@ApiTags('Cost Accounting - Menu Engineering')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@Controller({ path: 'cost-accounting/menu-engineering', version: '1' })
export class MenuEngineeringController {
  constructor(private readonly menuEngineeringService: MenuEngineeringService) {}

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate a new Menu Engineering snapshot',
    description:
      'Analyzes menu items using BCG matrix to classify as Stars, Plowhorses, Puzzles, or Dogs based on popularity vs profitability',
  })
  @ApiResponse({
    status: 201,
    description: 'Snapshot generated successfully',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          period: '2026-04',
          propertyId: 'uuid',
          avgPopularity: 45.5,
          avgMargin: 35.2,
          totalItems: 28,
          starsCount: 7,
          plowhorsesCount: 8,
          puzzlesCount: 5,
          dogsCount: 8,
          items: [
            {
              id: 'uuid',
              menuItemName: 'Caesar Salad',
              quantitySold: 120,
              marginPercent: 45.5,
              classification: 'STAR',
              recommendation: 'Maintain quality...',
            },
          ],
          createdAt: '2026-04-15T10:00:00Z',
        },
      },
    },
  })
  async generateSnapshot(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateSnapshotDto,
  ): Promise<{ success: boolean; data: SnapshotResponse }> {
    const snapshot = await this.menuEngineeringService.generateSnapshot(
      dto,
      user.sub,
      user.tenantId,
    );

    return {
      success: true,
      data: this.formatSnapshot(snapshot),
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List all Menu Engineering snapshots for a property',
  })
  @ApiQuery({
    name: 'propertyId',
    description: 'Property ID',
    required: true,
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number (0-indexed)',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Items per page',
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'List of snapshots',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            period: '2026-04',
            totalItems: 28,
            createdAt: '2026-04-15T10:00:00Z',
          },
        ],
        meta: {
          total: 12,
          page: 0,
          limit: 20,
        },
      },
    },
  })
  async listSnapshots(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
    @Query('page') page: string = '0',
    @Query('limit') limit: string = '20',
  ): Promise<{
    success: boolean;
    data: Partial<SnapshotResponse>[];
    meta: { total: number; page: number; limit: number };
  }> {
    if (!propertyId) {
      throw new BadRequestException('propertyId is required');
    }

    const pageNum = Math.max(0, parseInt(page, 10) || 0);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = pageNum * limitNum;

    const result = await this.menuEngineeringService.getSnapshots(
      user.tenantId,
      propertyId,
      skip,
      limitNum,
    );

    return {
      success: true,
      data: result.data.map((s) => ({
        id: s.id,
        period: s.period,
        totalItems: s.totalItems,
        starsCount: s.starsCount,
        plowhorsesCount: s.plowhorsesCount,
        puzzlesCount: s.puzzlesCount,
        dogsCount: s.dogsCount,
        createdAt: s.createdAt,
      })),
      meta: {
        total: result.total,
        page: pageNum,
        limit: limitNum,
      },
    };
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Get the latest Menu Engineering snapshot for a property',
  })
  @ApiQuery({
    name: 'propertyId',
    description: 'Property ID',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Latest snapshot with all items',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          period: '2026-04',
          avgPopularity: 45.5,
          items: [],
        },
      },
    },
  })
  async getLatestSnapshot(
    @CurrentUser() user: JwtPayload,
    @Query('propertyId') propertyId: string,
  ): Promise<{ success: boolean; data: SnapshotResponse | null }> {
    if (!propertyId) {
      throw new BadRequestException('propertyId is required');
    }

    const snapshot = await this.menuEngineeringService.getLatestSnapshot(user.tenantId, propertyId);

    return {
      success: true,
      data: snapshot ? this.formatSnapshot(snapshot) : null,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a specific Menu Engineering snapshot',
  })
  @ApiParam({
    name: 'id',
    description: 'Snapshot ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Snapshot details with all items',
    schema: {
      example: {
        success: true,
        data: {
          id: 'uuid',
          period: '2026-04',
          items: [],
        },
      },
    },
  })
  async getSnapshot(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: SnapshotResponse }> {
    const snapshot = await this.menuEngineeringService.getSnapshot(id, user.tenantId);

    return {
      success: true,
      data: this.formatSnapshot(snapshot),
    };
  }

  @Get(':id/summary')
  @ApiOperation({
    summary: 'Get classification summary for a snapshot',
    description: 'Returns items grouped by classification (Stars, Plowhorses, Puzzles, Dogs)',
  })
  @ApiParam({
    name: 'id',
    description: 'Snapshot ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Classification summary',
    schema: {
      example: {
        success: true,
        data: {
          stars: [
            {
              name: 'Caesar Salad',
              marginPercent: 45.5,
              quantitySold: 120,
              totalProfit: 5460,
            },
          ],
          plowhorses: [],
          puzzles: [],
          dogs: [],
          summary: {
            totalItems: 28,
            avgMargin: 35.2,
            avgPopularity: 45.5,
          },
        },
      },
    },
  })
  async getClassificationSummary(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: any }> {
    // Get snapshot to extract period and property
    const snapshot = await this.menuEngineeringService.getSnapshot(id, user.tenantId);

    const summary = await this.menuEngineeringService.getClassificationSummary(
      user.tenantId,
      snapshot.propertyId,
      snapshot.period,
    );

    return {
      success: true,
      data: {
        ...summary,
        stars: summary.stars.map((s) => ({
          name: s.name,
          marginPercent: Number(s.marginPercent),
          quantitySold: s.quantitySold,
          totalProfit: Number(s.totalProfit),
        })),
        plowhorses: summary.plowhorses.map((p) => ({
          name: p.name,
          marginPercent: Number(p.marginPercent),
          quantitySold: p.quantitySold,
          totalProfit: Number(p.totalProfit),
        })),
        puzzles: summary.puzzles.map((p) => ({
          name: p.name,
          marginPercent: Number(p.marginPercent),
          quantitySold: p.quantitySold,
          totalProfit: Number(p.totalProfit),
        })),
        dogs: summary.dogs.map((d) => ({
          name: d.name,
          marginPercent: Number(d.marginPercent),
          quantitySold: d.quantitySold,
          totalProfit: Number(d.totalProfit),
        })),
        summary: {
          totalItems: summary.summary.totalItems,
          avgMargin: Number(summary.summary.avgMargin),
          avgPopularity: Number(summary.summary.avgPopularity),
        },
      },
    };
  }

  @Post('compare')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compare two Menu Engineering snapshots',
    description: 'Shows which items improved/declined in classification and margin changes',
  })
  @ApiResponse({
    status: 200,
    description: 'Comparison results',
    schema: {
      example: {
        success: true,
        data: {
          improved: [
            {
              name: 'Caesar Salad',
              fromClassification: 'PLOWHORSE',
              toClassification: 'STAR',
              marginChange: 5.2,
            },
          ],
          declined: [],
          unchanged: 20,
        },
      },
    },
  })
  async compareSnapshots(
    @CurrentUser() user: JwtPayload,
    @Query('snapshot1') snapshot1: string,
    @Query('snapshot2') snapshot2: string,
  ): Promise<{ success: boolean; data: any }> {
    if (!snapshot1 || !snapshot2) {
      throw new BadRequestException('snapshot1 and snapshot2 query parameters are required');
    }

    const comparison = await this.menuEngineeringService.compareSnapshots(
      user.tenantId,
      snapshot1,
      snapshot2,
    );

    return {
      success: true,
      data: {
        improved: comparison.improved.map((i) => ({
          name: i.name,
          fromClassification: i.fromClassification,
          toClassification: i.toClassification,
          marginChange: Number(i.marginChange),
        })),
        declined: comparison.declined.map((d) => ({
          name: d.name,
          fromClassification: d.fromClassification,
          toClassification: d.toClassification,
          marginChange: Number(d.marginChange),
        })),
        unchanged: comparison.unchanged,
      },
    };
  }

  /**
   * Helper to format snapshot response
   */
  private formatSnapshot(snapshot: any): SnapshotResponse {
    return {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      propertyId: snapshot.propertyId,
      restaurantId: snapshot.restaurantId,
      period: snapshot.period,
      snapshotDate: snapshot.snapshotDate,
      avgPopularity: Number(snapshot.avgPopularity),
      avgMargin: Number(snapshot.avgMargin),
      totalItems: snapshot.totalItems,
      starsCount: snapshot.starsCount,
      plowhorsesCount: snapshot.plowhorsesCount,
      puzzlesCount: snapshot.puzzlesCount,
      dogsCount: snapshot.dogsCount,
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt,
      items: snapshot.items?.map((item: any) => ({
        id: item.id,
        menuItemName: item.menuItemName,
        categoryName: item.categoryName,
        quantitySold: item.quantitySold,
        sellingPrice: Number(item.sellingPrice),
        ingredientCost: Number(item.ingredientCost),
        contributionMargin: Number(item.contributionMargin),
        marginPercent: Number(item.marginPercent),
        totalRevenue: Number(item.totalRevenue),
        totalCost: Number(item.totalCost),
        totalProfit: Number(item.totalProfit),
        popularityIndex: Number(item.popularityIndex),
        classification: item.classification,
        recommendation: item.recommendation,
      })),
    };
  }
}
