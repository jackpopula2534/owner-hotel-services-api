import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { HotelTerminalUsersController } from './hotel-terminal-users.controller';
import { HotelTerminalUsersService } from './hotel-terminal-users.service';

@Module({
  imports: [PrismaModule, StaffModule],
  controllers: [HotelTerminalUsersController],
  providers: [HotelTerminalUsersService],
  exports: [HotelTerminalUsersService],
})
export class HotelTerminalUsersModule {}
