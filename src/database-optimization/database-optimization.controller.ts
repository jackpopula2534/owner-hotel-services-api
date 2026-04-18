import { Controller, Get, Post, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QueryPerformanceService } from './query-performance.service';

@ApiTags('Database Performance (Admin)')
@Controller('admin/database')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DatabaseOptimizationController {
  constructor(private readonly queryPerformanceService: QueryPerformanceService) {}

  /**
   * Get slow query report
   */
  @Get('slow-queries')
  @ApiOperation({ summary: 'Get slow query report' })
  @ApiResponse({ status: 200, description: 'Returns slow query statistics' })
  getSlowQueryReport() {
    return this.queryPerformanceService.getSlowQueryReport();
  }

  /**
   * Analyze query patterns
   */
  @Get('query-patterns')
  @ApiOperation({ summary: 'Analyze query patterns and get recommendations' })
  @ApiResponse({
    status: 200,
    description: 'Returns query patterns and optimization recommendations',
  })
  async analyzeQueryPatterns() {
    return this.queryPerformanceService.analyzeQueryPatterns();
  }

  /**
   * Detect N+1 queries
   */
  @Get('n1-detection')
  @ApiOperation({ summary: 'Detect potential N+1 query problems' })
  @ApiResponse({ status: 200, description: 'Returns N+1 detection results' })
  detectN1Queries() {
    return this.queryPerformanceService.detectN1Queries();
  }

  /**
   * Get database health metrics
   */
  @Get('health')
  @ApiOperation({ summary: 'Get database health metrics' })
  @ApiResponse({ status: 200, description: 'Returns database health statistics' })
  async getDatabaseHealth() {
    return this.queryPerformanceService.getDatabaseHealth();
  }

  /**
   * Clear query metrics
   */
  @Post('clear-metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear query metrics history' })
  @ApiResponse({ status: 200, description: 'Metrics cleared successfully' })
  clearMetrics() {
    this.queryPerformanceService.clearMetrics();
    return { success: true, message: 'Query metrics cleared' };
  }
}
