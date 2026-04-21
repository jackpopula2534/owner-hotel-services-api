import { Module } from '@nestjs/common';
import { AddonController } from './addon.controller';
import { AddonService } from './addon.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonGuard } from '@/common/guards/addon.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AddonController],
  providers: [AddonService, AddonGuard],
  exports: [AddonService, AddonGuard],
})
export class AddonModule {}
