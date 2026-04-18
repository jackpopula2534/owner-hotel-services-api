import { Module } from '@nestjs/common';
import { QCController } from './qc.controller';
import { QCService } from './qc.service';

@Module({
  controllers: [QCController],
  providers: [QCService],
  exports: [QCService],
})
export class QCModule {}
