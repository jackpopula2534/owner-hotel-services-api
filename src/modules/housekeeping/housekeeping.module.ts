import { Module } from '@nestjs/common';
import { HousekeepingService } from './housekeeping.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  providers: [HousekeepingService, PrismaService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
