import { Module } from '@nestjs/common';
import { AccountingUsersController } from './accounting-users.controller';
import { AccountingUsersService } from './accounting-users.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [AccountingUsersController],
  providers: [AccountingUsersService, PrismaService],
  exports: [AccountingUsersService],
})
export class AccountingUsersModule {}
