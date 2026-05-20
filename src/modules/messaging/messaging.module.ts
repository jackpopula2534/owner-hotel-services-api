import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { LineMessagingService } from './line-messaging.service';
import { FacebookMessagingService } from './facebook-messaging.service';
import { AutoReplyService } from './auto-reply.service';
import { MessagingGateway } from './messaging.gateway';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    LineMessagingService,
    FacebookMessagingService,
    AutoReplyService,
    MessagingGateway,
  ],
  exports: [MessagingService, LineMessagingService, FacebookMessagingService],
})
export class MessagingModule {}
