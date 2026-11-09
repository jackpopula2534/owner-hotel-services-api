import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { ArStatementsController } from './ar-statements.controller';
import { ArStatementsService } from './ar-statements.service';

@Module({
  imports: [AddonModule],
  controllers: [ArStatementsController],
  providers: [ArStatementsService],
  exports: [ArStatementsService],
})
export class ArStatementsModule {}
