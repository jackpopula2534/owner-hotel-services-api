import { Module, Global } from '@nestjs/common';
import { QueryPerformanceService } from './query-performance.service';
import { DatabaseOptimizationController } from './database-optimization.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [DatabaseOptimizationController],
  providers: [QueryPerformanceService],
  exports: [QueryPerformanceService],
})
export class DatabaseOptimizationModule {}
