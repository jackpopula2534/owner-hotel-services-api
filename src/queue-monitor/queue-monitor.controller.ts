import { Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QueueMonitorService } from './queue-monitor.service';

@ApiTags('Admin / Queue Monitor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'admin/queues', version: '1' })
export class QueueMonitorController {
  constructor(private readonly service: QueueMonitorService) {}

  @Get('stats')
  @ApiOperation({ summary: 'List queues with job counts' })
  async stats() {
    return this.service.getStats();
  }

  @Get(':name/failed')
  @ApiOperation({ summary: 'List failed jobs for a queue' })
  async failed(@Param('name') name: string, @Query('limit') limit?: string) {
    return this.service.listFailed(name, limit ? parseInt(limit, 10) : 50);
  }

  @Post(':name/jobs/:jobId/retry')
  @ApiOperation({ summary: 'Retry a failed job' })
  async retry(@Param('name') name: string, @Param('jobId') jobId: string) {
    await this.service.retryFailed(name, jobId);
    return { success: true };
  }

  @Delete(':name/jobs/:jobId')
  @ApiOperation({ summary: 'Remove a failed job' })
  async remove(@Param('name') name: string, @Param('jobId') jobId: string) {
    await this.service.removeFailed(name, jobId);
    return { success: true };
  }
}
