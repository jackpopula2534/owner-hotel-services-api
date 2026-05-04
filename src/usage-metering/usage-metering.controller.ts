import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsageMeteringService } from './usage-metering.service';

@ApiTags('Usage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'usage', version: '1' })
export class UsageMeteringController {
  constructor(private readonly usage: UsageMeteringService) {}

  @Get('snapshots')
  @ApiOperation({
    summary:
      "List the active tenant's usage counters for the given period (defaults to current month).",
  })
  async list(@CurrentUser() user: any, @Query('period') period?: string) {
    return this.usage.listSnapshots(user.tenant_id, period);
  }
}
