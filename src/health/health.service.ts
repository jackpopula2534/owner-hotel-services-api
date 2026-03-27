import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime?: number;
  version?: string;
  checks?: Record<string, CheckResult>;
}

interface CheckResult {
  status: 'up' | 'down' | 'degraded';
  latencyMs?: number;
  error?: string;
  note?: string;
}

// Individual checks must resolve within this window.
// Keeps K8s probes (periodSeconds: 10) from timing out waiting for a hung DB.
const CHECK_TIMEOUT_MS = 5_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Liveness — confirms the process is alive and the event loop is not frozen.
   * Never checks external dependencies; must always return 200.
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
   * Readiness — verifies every critical dependency is reachable.
   * Used by K8s / Docker probes to gate traffic.
   * All three checks run in parallel; each has an individual timeout.
   */
  async readinessCheck(): Promise<HealthCheckResult> {
    const [prismaResult, typeormResult, redisResult] = await Promise.allSettled([
      this.checkPrisma(),
      this.checkTypeOrm(),
      this.checkRedis(),
    ]);

    const checks: Record<string, CheckResult> = {
      database: this.unwrap(prismaResult, 'prisma'),
      typeorm: this.unwrap(typeormResult, 'typeorm'),
      cache: this.unwrap(redisResult, 'redis'),
    };

    // redis degraded is acceptable — app still runs without cache
    const criticalDown = checks.database.status === 'down' || checks.typeorm.status === 'down';
    const anyDown = Object.values(checks).some((c) => c.status === 'down');
    const allUp = Object.values(checks).every((c) => c.status === 'up');

    const result: HealthCheckResult = {
      status: allUp ? 'ok' : criticalDown ? 'down' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };

    if (result.status === 'down') {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'Service unavailable — critical dependencies are down',
        ...result,
      });
    }

    return result;
  }

  // ── Individual checks ─────────────────────────────────────────────────────

  private async checkPrisma(): Promise<CheckResult> {
    return this.runCheck('prisma', () => this.prisma.$queryRaw`SELECT 1`);
  }

  private async checkTypeOrm(): Promise<CheckResult> {
    return this.runCheck('typeorm', async () => {
      // NestJS initializes the DataSource during forRootAsync bootstrap.
      // If it is not initialized here, the connection was never established —
      // do NOT call initialize() again as it throws "already connected" in
      // TypeORM 0.3.x.  Simply report down and let NestJS retry logic handle it.
      if (!this.dataSource.isInitialized) {
        throw new Error('DataSource is not initialized');
      }
      await this.dataSource.query('SELECT 1');
    });
  }

  private async checkRedis(): Promise<CheckResult> {
    return this.runCheck('redis', async () => {
      if (!this.cacheService.isAvailable()) {
        return 'degraded' as const;
      }
      await this.cacheService.set('__health_check__', 'ok', { ttl: 5 });
      await this.cacheService.del('__health_check__');
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Runs `fn` with an individual timeout.  Returns { status, latencyMs }
   * on success, { status: 'down', error } on failure or timeout.
   */
  private async runCheck(name: string, fn: () => Promise<'degraded' | void>): Promise<CheckResult> {
    const start = Date.now();
    try {
      const signal = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`Timeout after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS),
      );
      const result = await Promise.race([fn(), signal]);
      const latencyMs = Date.now() - start;

      if (result === 'degraded') {
        return { status: 'degraded', latencyMs, note: 'Service initialized but not connected' };
      }
      return { status: 'up', latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      this.logger.error(`${name} health check failed (${latencyMs}ms): ${err.message}`);
      return { status: 'down', latencyMs, error: err.message };
    }
  }

  /** Converts a PromiseSettledResult into a CheckResult. */
  private unwrap(result: PromiseSettledResult<CheckResult>, name: string): CheckResult {
    if (result.status === 'fulfilled') return result.value;
    this.logger.error(`${name} check threw unexpectedly: ${result.reason}`);
    return { status: 'down', error: String(result.reason) };
  }
}
