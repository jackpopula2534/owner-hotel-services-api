import { Module } from '@nestjs/common';
import { HrTerminalUsersController } from './hr-terminal-users.controller';
import { HrTerminalUsersService } from './hr-terminal-users.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [HrTerminalUsersController],
  providers: [HrTerminalUsersService, PrismaService],
  exports: [HrTerminalUsersService],
})
export class HrTerminalUsersModule {}
