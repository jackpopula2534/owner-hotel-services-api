import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RevenueModule } from '../revenue/revenue.module';

@Module({
  // ยอดเงินทุกตัวในรายงานมาจากสมุดรายได้ ไม่ได้บวกเองจากตารางต้นทางอีกแล้ว
  imports: [PrismaModule, RevenueModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
