import { Module } from '@nestjs/common';
import { PeriodCloseService } from './period-close.service';
import { PeriodCloseController } from './period-close.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  providers: [PeriodCloseService, PrismaService],
  controllers: [PeriodCloseController],
  exports: [PeriodCloseService],
})
export class PeriodCloseModule {}
