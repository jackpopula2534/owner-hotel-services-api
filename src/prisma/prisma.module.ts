import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { EncryptionService } from '../common/services/encryption.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [EncryptionService, PrismaService],
  exports: [PrismaService, EncryptionService],
})
export class PrismaModule {}
