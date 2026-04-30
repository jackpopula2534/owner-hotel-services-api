import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { HotelTerminalUsersController } from './hotel-terminal-users.controller';
import { HotelTerminalUsersService } from './hotel-terminal-users.service';

@Module({
  imports: [PrismaModule],
  controllers: [HotelTerminalUsersController],
  providers: [HotelTerminalUsersService],
  exports: [HotelTerminalUsersService],
})
export class HotelTerminalUsersModule {}
