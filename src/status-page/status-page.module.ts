import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StatusPageService } from './status-page.service';
import { StatusPageController } from './status-page.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StatusPageController],
  providers: [StatusPageService],
  exports: [StatusPageService],
})
export class StatusPageModule {}
