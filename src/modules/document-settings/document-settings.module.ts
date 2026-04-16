import { Module } from '@nestjs/common';
import { DocumentSettingsController } from './document-settings.controller';
import { DocumentSettingsService } from './document-settings.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentSettingsController],
  providers: [DocumentSettingsService],
  exports: [DocumentSettingsService],
})
export class DocumentSettingsModule {}
