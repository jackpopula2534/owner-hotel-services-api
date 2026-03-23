import { Module } from '@nestjs/common';
import { MobileApiService } from './mobile-api.service';
import { MobileApiController } from './mobile-api.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [PrismaModule, CacheModule],
  controllers: [MobileApiController],
  providers: [MobileApiService],
  exports: [MobileApiService],
})
export class MobileApiModule {}
