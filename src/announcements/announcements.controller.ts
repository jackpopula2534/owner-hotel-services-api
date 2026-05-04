import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnnouncementsService, CreateAnnouncementInput } from './announcements.service';

@ApiTags('Announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'announcements', version: '1' })
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  // ── Admin ──
  @Post('admin')
  @ApiOperation({ summary: '[Admin] Create announcement / broadcast' })
  async create(@CurrentUser() user: any, @Body() body: CreateAnnouncementInput) {
    return this.service.create({
      ...body,
      createdBy: user.id || user.user_id,
    });
  }

  @Get('admin')
  @ApiOperation({ summary: '[Admin] List all announcements' })
  async listAll(@Query('activeOnly') activeOnly?: string) {
    return this.service.list({ activeOnly: activeOnly === 'true' });
  }

  @Patch('admin/:id/expire')
  @ApiOperation({ summary: '[Admin] Expire (hide) an announcement immediately' })
  async expire(@Param('id') id: string) {
    return this.service.expire(id);
  }

  // ── Tenant ──
  @Get('mine')
  @ApiOperation({ summary: 'List announcements visible to the active tenant' })
  async mine(@CurrentUser() user: any) {
    return this.service.listForTenant(user.tenant_id, user.tenant_status || null);
  }

  @Get('mine/unread-count')
  @ApiOperation({ summary: 'Unread count for badge in nav' })
  async unread(@CurrentUser() user: any) {
    const count = await this.service.unreadCount(user.tenant_id, user.tenant_status || null);
    return { count };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark as read' })
  async markRead(@CurrentUser() user: any, @Param('id') id: string) {
    await this.service.markAsRead({
      announcementId: id,
      tenantId: user.tenant_id,
      userId: user.id || user.user_id,
    });
    return { success: true };
  }
}
