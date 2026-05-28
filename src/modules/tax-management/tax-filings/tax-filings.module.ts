import { Module } from '@nestjs/common';
import { TaxFilingsController } from './tax-filings.controller';
import { TaxFilingsService } from './tax-filings.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [TaxFilingsController],
  providers: [TaxFilingsService],
  exports: [TaxFilingsService],
})
export class TaxFilingsModule {}
