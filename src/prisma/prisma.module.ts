import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { EncryptionService } from '../common/services/encryption.service';

@Global()
@Module({
  providers: [EncryptionService, PrismaService],
  exports: [PrismaService, EncryptionService],
})
export class PrismaModule {}
