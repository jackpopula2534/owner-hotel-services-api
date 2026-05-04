import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ImpersonationService, ImpersonationScope } from './impersonation.service';

@ApiTags('Admin / Impersonation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'admin/impersonation', version: '1' })
export class ImpersonationController {
  constructor(private readonly service: ImpersonationService) {}

  @Post()
  @ApiOperation({ summary: 'Start an impersonation session for a tenant' })
  async start(
    @CurrentUser() user: any,
    @Body()
    body: {
      tenantId: string;
      reason: string;
      scope?: ImpersonationScope;
      ttlMinutes?: number;
    },
    @Req() req: Request,
  ) {
    return this.service.start({
      adminId: user.id || user.user_id,
      tenantId: body.tenantId,
      reason: body.reason,
      scope: body.scope,
      ttlMinutes: body.ttlMinutes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':sessionId')
  @ApiOperation({ summary: 'End an impersonation session' })
  async end(@CurrentUser() user: any, @Param('sessionId') sessionId: string) {
    await this.service.end(sessionId, user.id || user.user_id);
    return { success: true };
  }

  @Get()
  @ApiOperation({ summary: 'List recent impersonation sessions' })
  async list(
    @Query('adminId') adminId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: 'active' | 'ended' | 'expired',
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      adminId,
      tenantId,
      status,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
