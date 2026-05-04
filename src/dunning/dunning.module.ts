import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { TenantsModule } from '../tenants/tenants.module';
import { DunningService } from './dunning.service';
import { DunningController } from './dunning.controller';

@Module({
  imports: [PrismaModule, ConfigModule, EmailModule, TenantsModule, ScheduleModule.forRoot()],
  controllers: [DunningController],
  providers: [DunningService],
  exports: [DunningService],
})
export class DunningModule {}
