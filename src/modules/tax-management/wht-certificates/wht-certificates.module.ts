import { Module } from '@nestjs/common';
import { WhtCertificatesController } from './wht-certificates.controller';
import { WhtCertificatesService } from './wht-certificates.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [WhtCertificatesController],
  providers: [WhtCertificatesService],
  exports: [WhtCertificatesService],
})
export class WhtCertificatesModule {}
