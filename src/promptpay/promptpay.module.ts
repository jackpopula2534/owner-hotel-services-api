import { Module } from '@nestjs/common';
import { PromptPayService } from './promptpay.service';
import { PromptPayController } from './promptpay.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [PromptPayController],
  providers: [PromptPayService],
  exports: [PromptPayService],
})
export class PromptPayModule {}
