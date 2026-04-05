import { Module } from '@nestjs/common';
import { AddonController } from './addon.controller';
import { AddonService } from './addon.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AddonController],
  providers: [AddonService],
  exports: [AddonService],
})
export class AddonModule {}
