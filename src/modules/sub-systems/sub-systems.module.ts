import { Module } from '@nestjs/common';
import { SubSystemsController } from './sub-systems.controller';
import { SubSystemsService } from './sub-systems.service';
import { AddonModule } from '../addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [SubSystemsController],
  providers: [SubSystemsService],
  exports: [SubSystemsService],
})
export class SubSystemsModule {}
