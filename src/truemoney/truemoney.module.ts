import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TrueMoneyController } from './truemoney.controller';
import { TrueMoneyService } from './truemoney.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [TrueMoneyController],
  providers: [TrueMoneyService],
  exports: [TrueMoneyService],
})
export class TrueMoneyModule {}
