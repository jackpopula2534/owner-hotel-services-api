import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyTimeSettingsService } from './property-time-settings.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, PropertyTimeSettingsService],
  exports: [PropertiesService, PropertyTimeSettingsService],
})
export class PropertiesModule {}
