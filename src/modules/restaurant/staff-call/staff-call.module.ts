import { Module } from '@nestjs/common';
import { StaffCallController } from './staff-call.controller';
import { StaffCallPublicController } from './staff-call-public.controller';
import { StaffCallService } from './staff-call.service';
import { StaffCallGateway } from './staff-call.gateway';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StaffCallController, StaffCallPublicController],
  providers: [StaffCallService, StaffCallGateway],
  exports: [StaffCallService, StaffCallGateway],
})
export class StaffCallModule {}
