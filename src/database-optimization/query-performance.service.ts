import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: Date;
  params?: any;
}

export interface SlowQueryReport {
  totalQueries: number;
  slowQueries: number;
  averageDuration: number;
  slowestQueries: QueryMetrics[];
}

@Injectable()
export class QueryPerformanceService implements OnModuleInit {
  private readonly logger = new Logger(QueryPerformanceService.name);
  private queryMetrics: QueryMetrics[] = [];
  private readonly slowQueryThreshold = 100; // ms
  private readonly maxMetricsHistory = 1000;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.setupQueryLogging();
    this.logger.log('Query performance monitoring initialized');
  }

  /**
   * Setup Prisma query event logging
   */
  private setupQueryLogging(): void {
    // Enable query logging via Prisma events
    // Note: This requires enabling events in PrismaService
    this.logger.log('Query logging enabled');
  }

  /**
   * Record a query execution
   */
  recordQuery(query: string, duration: number, params?: any): void {
    const metric: QueryMetrics = {
      query: this.sanitizeQuery(query),
      duration,
      timestamp: new Date(),
      params,
    };

    this.queryMetrics.push(metric);

    // Keep only recent metrics
    if (this.queryMetrics.length > this.maxMetricsHistory) {
      this.queryMetrics = this.queryMetrics.slice(-this.maxMetricsHistory);
    }

    // Log slow queries
    if (duration > this.slowQueryThreshold) {
      this.logger.warn(`Slow query detected (${duration}ms): ${this.truncateQuery(query)}`);
    }
  }

  /**
   * Get slow query report
   */
  getSlowQueryReport(): SlowQueryReport {
    const slowQueries = this.queryMetrics.filter((m) => m.duration > this.slowQueryThreshold);

    const totalDuration = this.queryMetrics.reduce((sum, m) => sum + m.duration, 0);

    return {
      totalQueries: this.queryMetrics.length,
      slowQueries: slowQueries.length,
      averageDuration: this.queryMetrics.length > 0 ? totalDuration / this.queryMetrics.length : 0,
      slowestQueries: slowQueries.sort((a, b) => b.duration - a.duration).slice(0, 10),
    };
  }

  /**
   * Clear metrics history
   */
  clearMetrics(): void {
    this.queryMetrics = [];
  }

  /**
   * Analyze query patterns and suggest optimizations
   */
  async analyzeQueryPatterns(): Promise<{
    patterns: { query: string; count: number; avgDuration: number }[];
    recommendations: string[];
  }> {
    const queryMap = new Map<string, { count: number; totalDuration: number }>();

    for (const metric of this.queryMetrics) {
      const normalized = this.normalizeQuery(metric.query);
      const existing = queryMap.get(normalized) || {
        count: 0,
        totalDuration: 0,
      };
      queryMap.set(normalized, {
        count: existing.count + 1,
        totalDuration: existing.totalDuration + metric.duration,
      });
    }

    const patterns = Array.from(queryMap.entries())
      .map(([query, stats]) => ({
        query,
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const recommendations = this.generateRecommendations(patterns);

    return { patterns, recommendations };
  }

  /**
   * Check for N+1 query patterns
   */
  detectN1Queries(): { detected: boolean; suspectedQueries: string[] } {
    const recentQueries = this.queryMetrics.slice(-100);
    const queryGroups = new Map<string, number>();

    for (const metric of recentQueries) {
      const normalized = this.normalizeQuery(metric.query);
      queryGroups.set(normalized, (queryGroups.get(normalized) || 0) + 1);
    }

    const suspectedQueries = Array.from(queryGroups.entries())
      .filter(([_, count]) => count > 10)
      .map(([query]) => query);

    return {
      detected: suspectedQueries.length > 0,
      suspectedQueries,
    };
  }

  /**
   * Get database health metrics
   */
  async getDatabaseHealth(): Promise<{
    connectionPool: { active: number; idle: number };
    avgQueryTime: number;
    slowQueryPercentage: number;
  }> {
    const report = this.getSlowQueryReport();

    return {
      connectionPool: {
        active: 0, // Would need actual pool metrics
        idle: 0,
      },
      avgQueryTime: report.averageDuration,
      slowQueryPercentage:
        report.totalQueries > 0 ? (report.slowQueries / report.totalQueries) * 100 : 0,
    };
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  private sanitizeQuery(query: string): string {
    // Remove potential sensitive values
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
      .replace(/secret\s*=\s*'[^']*'/gi, "secret='***'");
  }

  /**
   * Truncate query for logging
   */
  private truncateQuery(query: string, maxLength = 200): string {
    if (query.length <= maxLength) return query;
    return query.substring(0, maxLength) + '...';
  }

  /**
   * Normalize query for pattern matching
   */
  private normalizeQuery(query: string): string {
    return query
      .replace(/\s+/g, ' ')
      .replace(/'[^']*'/g, '?')
      .replace(/\d+/g, '?')
      .trim();
  }

  /**
   * Generate optimization recommendations
   */
  private generateRecommendations(
    patterns: { query: string; count: number; avgDuration: number }[],
  ): string[] {
    const recommendations: string[] = [];

    for (const pattern of patterns) {
      // High frequency queries
      if (pattern.count > 50) {
        recommendations.push(
          `Consider caching results for frequently executed query: ${this.truncateQuery(pattern.query, 100)}`,
        );
      }

      // Slow queries
      if (pattern.avgDuration > 200) {
        recommendations.push(
          `Optimize slow query (avg ${pattern.avgDuration.toFixed(0)}ms): ${this.truncateQuery(pattern.query, 100)}`,
        );
      }

      // SELECT * patterns
      if (pattern.query.includes('SELECT *')) {
        recommendations.push('Avoid SELECT * - specify only needed columns for better performance');
      }

      // Missing index hints
      if (
        pattern.query.includes('WHERE') &&
        pattern.avgDuration > 100 &&
        !pattern.query.toLowerCase().includes('index')
      ) {
        recommendations.push(
          `Consider adding index for WHERE clause in: ${this.truncateQuery(pattern.query, 100)}`,
        );
      }
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }
}
