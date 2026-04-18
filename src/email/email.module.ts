import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailProcessor } from './processors/email.processor';
import { EmailEventsService } from './email-events.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD', undefined),
          // Limit reconnect attempts so seeder / test runs don't flood logs.
          // In production the process restarts anyway if Redis is permanently down.
          retryStrategy: (times: number) => {
            if (times > 5) return null; // stop retrying after 5 attempts
            return Math.min(times * 500, 5000); // 500ms → 5 000ms back-off
          },
          // Do not block startup waiting for the ready ping
          enableReadyCheck: false,
          // Don't throw on commands when the connection is not yet ready
          maxRetriesPerRequest: null,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'email',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }),
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailProcessor, EmailEventsService],
  exports: [EmailService, EmailEventsService],
})
export class EmailModule {}
