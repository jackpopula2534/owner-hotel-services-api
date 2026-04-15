import { Module } from '@nestjs/common';
import { MenuEngineeringService } from './menu-engineering.service';
import { MenuEngineeringController } from './menu-engineering.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [MenuEngineeringController],
  providers: [MenuEngineeringService, PrismaService],
  exports: [MenuEngineeringService],
})
export class MenuEngineeringModule {}
