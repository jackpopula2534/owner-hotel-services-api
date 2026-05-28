import { Module } from '@nestjs/common';
import { GuestFolioController } from './guest-folio.controller';
import { GuestFolioService } from './guest-folio.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [GuestFolioController],
  providers: [GuestFolioService],
  exports: [GuestFolioService],
})
export class GuestFolioModule {}
