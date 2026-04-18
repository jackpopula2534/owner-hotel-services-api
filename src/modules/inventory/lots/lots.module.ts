import { Module } from '@nestjs/common';
import { LotsService } from './lots.service';
import { LotsController, ItemLotsController } from './lots.controller';

@Module({
  controllers: [LotsController, ItemLotsController],
  providers: [LotsService],
  exports: [LotsService],
})
export class LotsModule {}
