import { Controller, Get, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness check - indicates application is running' })
  @ApiResponse({
    status: 200,
    description: 'Service is alive and running',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-03-23T10:30:00.000Z',
        uptime: 1234.56,
        version: '1.0.0',
      },
    },
  })
  async check() {
    return this.healthService.check();
  }

  @Get('ready')
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Readiness check - verifies all critical dependencies (database, cache)',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is ready to accept traffic',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-03-23T10:30:00.000Z',
        checks: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service is degraded or unhealthy',
    schema: {
      example: {
        status: 'degraded',
        timestamp: '2026-03-23T10:30:00.000Z',
        checks: {
          database: { status: 'down', error: 'Connection timeout' },
          redis: { status: 'up' },
        },
      },
    },
  })
  async ready() {
    return this.healthService.readinessCheck();
  }
}
