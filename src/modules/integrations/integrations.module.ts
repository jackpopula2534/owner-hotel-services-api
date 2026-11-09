import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Integration Hub module. Exports IntegrationsService so event listeners
 * (e.g. InventoryEventListener) can gate automated behaviour on the tenant's
 * connection settings.
 */
@Module({
  imports: [PrismaModule, AddonModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
