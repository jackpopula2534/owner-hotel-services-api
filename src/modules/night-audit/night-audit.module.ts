import { Module } from '@nestjs/common';
import { NightAuditController } from './night-audit.controller';
import { NightAuditService } from './night-audit.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [NightAuditController],
  providers: [NightAuditService],
  exports: [NightAuditService],
})
export class NightAuditModule {}
