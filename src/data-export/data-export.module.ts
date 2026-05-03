import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DataExportService } from './data-export.service';
import { DataExportController } from './data-export.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DataExportController],
  providers: [DataExportService],
  exports: [DataExportService],
})
export class DataExportModule {}
