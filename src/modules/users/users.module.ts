import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserExpirationScheduler } from './user-expiration.scheduler';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [UsersController],
  providers: [UsersService, UserExpirationScheduler],
  exports: [UsersService, UserExpirationScheduler],
})
export class UsersModule {}
