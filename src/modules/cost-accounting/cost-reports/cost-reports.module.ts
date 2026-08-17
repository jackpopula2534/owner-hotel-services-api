import { Module } from '@nestjs/common';
import { CostReportsService } from './cost-reports.service';
import { CostReportsController } from './cost-reports.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { RevenueModule } from '@/modules/revenue/revenue.module';

@Module({
  // ยอดขายรายประเภทห้องแบบสด อ่านจากสมุดรายได้ ตัวเดียวกับตอนปิดงวด
  imports: [AddonModule, RevenueModule],
  providers: [CostReportsService, PrismaService],
  controllers: [CostReportsController],
  exports: [CostReportsService],
})
export class CostReportsModule {}
