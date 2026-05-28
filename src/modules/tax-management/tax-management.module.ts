import { Module } from '@nestjs/common';
import { TaxRatesModule } from './tax-rates/tax-rates.module';
import { WhtCertificatesModule } from './wht-certificates/wht-certificates.module';
import { TaxFilingsModule } from './tax-filings/tax-filings.module';

@Module({
  imports: [TaxRatesModule, WhtCertificatesModule, TaxFilingsModule],
  exports: [TaxRatesModule, WhtCertificatesModule, TaxFilingsModule],
})
export class TaxManagementModule {}
