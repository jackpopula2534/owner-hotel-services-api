import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LineNotifyService } from './line-notify.service';
import { LineNotifyEventsService } from './line-notify-events.service';
import { LineNotifyController } from './line-notify.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global() // Make LineNotifyEventsService globally available
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [LineNotifyController],
  providers: [LineNotifyService, LineNotifyEventsService],
  exports: [LineNotifyService, LineNotifyEventsService],
})
export class LineNotifyModule {}
