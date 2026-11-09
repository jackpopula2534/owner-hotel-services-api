import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { TenantModule } from '../common/tenant/tenant.module';

@Global()
@Module({
  // PrismaService depends on TenantContextService (tenant-scope middleware).
  // Importing TenantModule here makes PrismaModule self-sufficient so it
  // resolves in any context — including TestingModules that import a feature
  // module without bootstrapping the whole AppModule's global providers.
  imports: [ConfigModule, TenantModule],
  providers: [EncryptionService, PrismaService],
  exports: [PrismaService, EncryptionService],
})
export class PrismaModule {}
