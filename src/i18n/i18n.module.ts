import { Module, Global } from '@nestjs/common';
import { I18nService } from './i18n.service';
import { I18nController } from './i18n.controller';

@Global() // Make I18nService globally available
@Module({
  controllers: [I18nController],
  providers: [I18nService],
  exports: [I18nService],
})
export class I18nModule {}
