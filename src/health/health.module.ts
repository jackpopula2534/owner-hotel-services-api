import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    DatabaseModule, // provides DataSource for @InjectDataSource() in HealthService
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
