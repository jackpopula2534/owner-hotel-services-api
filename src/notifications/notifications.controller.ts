import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'notifications', version: '1' })
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(@CurrentUser() user: { userId: string }, @Query() query: NotificationQueryDto) {
    return this.notificationsService.findAll(user.userId, query);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.notificationsService.markAsRead(id, user.userId);
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.markAllAsRead(user.userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.notificationsService.remove(id, user.userId);
  }
}
