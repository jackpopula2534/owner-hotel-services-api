import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime?: number;
  version?: string;
  checks?: Record<string, any>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Liveness check - simple indicator that the application is running
   */
  async check(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  /**
   * Readiness check - verifies all critical dependencies are available
   * This check is used by orchestration platforms (K8s, Docker, etc.) to determine
   * if the service is ready to accept traffic
   */
  async readinessCheck(): Promise<HealthCheckResult> {
    const checks: Record<string, any> = {};
    const errors: string[] = [];

    // Check Database connectivity
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'up' };
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${error.message}`,
        error.stack,
      );
      checks.database = {
        status: 'down',
        error: 'Connection failed',
      };
      errors.push('database');
    }

    // Check Redis/Cache connectivity
    try {
      const isCacheAvailable = this.cacheService.isAvailable();
      if (isCacheAvailable) {
        // Test cache with a simple operation
        await this.cacheService.set(
          '__health_check__',
          'test',
          { ttl: 5 },
        );
        await this.cacheService.del('__health_check__');
        checks.redis = { status: 'up' };
      } else {
        checks.redis = {
          status: 'degraded',
          note: 'Cache service initialized but not connected',
        };
      }
    } catch (error) {
      this.logger.warn(
        `Redis health check failed: ${error.message}`,
        error.stack,
      );
      checks.redis = {
        status: 'down',
        error: 'Connection failed',
      };
      errors.push('redis');
    }

    // Determine overall status
    const allHealthy = Object.values(checks).every(
      (c: any) => c.status === 'up',
    );
    const anyDown = errors.length > 0;

    const result: HealthCheckResult = {
      status: allHealthy ? 'ok' : anyDown ? 'down' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };

    // Return 503 if service is down
    if (result.status === 'down') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Service unavailable - critical dependencies are down',
        ...result,
      });
    }

    return result;
  }
}
