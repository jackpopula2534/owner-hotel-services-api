import { Module } from '@nestjs/common';
import { QRController } from './qr.controller';
import { QRService } from './qr.service';
import { QrCodeService } from '@/common/services/qr-code.service';

@Module({
  controllers: [QRController],
  providers: [QRService, QrCodeService],
  exports: [QRService, QrCodeService],
})
export class QRModule {}
