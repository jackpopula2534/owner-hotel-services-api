import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { DunningService } from './dunning.service';

@ApiTags('Admin / Dunning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'admin/dunning', version: '1' })
export class DunningController {
  constructor(private readonly dunningService: DunningService) {}

  @Get('attempts')
  @ApiOperation({ summary: 'List dunning attempts (admin queue)' })
  async list(
    @Query('tenantId') tenantId?: string,
    @Query('level') level?: 'reminder' | 'first_warning' | 'second_warning' | 'final_notice',
    @Query('status') status?: 'queued' | 'sent' | 'failed' | 'acknowledged',
    @Query('limit') limit?: string,
  ) {
    return this.dunningService.listAttempts({
      tenantId,
      level,
      status,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }

  @Post('invoices/:invoiceId/send')
  @ApiOperation({ summary: 'Manually send a dunning email at the given level' })
  async sendManual(
    @Param('invoiceId') invoiceId: string,
    @Body('level') level: 'reminder' | 'first_warning' | 'second_warning' | 'final_notice',
  ) {
    return this.dunningService.sendManual(invoiceId, level);
  }

  @Post('attempts/:attemptId/acknowledge')
  @ApiOperation({ summary: 'Mark an attempt as customer-acknowledged' })
  async acknowledge(@Param('attemptId') attemptId: string) {
    await this.dunningService.acknowledge(attemptId);
    return { success: true };
  }

  @Post('run-now')
  @ApiOperation({ summary: 'Trigger the daily dunning cron immediately' })
  async runNow() {
    return this.dunningService.runDailyDunning();
  }
}
