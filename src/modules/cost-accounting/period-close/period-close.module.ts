import { Module } from '@nestjs/common';
import { PeriodCloseService } from './period-close.service';
import { PeriodCloseController } from './period-close.controller';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { RevenueModule } from '@/modules/revenue/revenue.module';

@Module({
  // ยอดขายรายประเภทห้อง/รายเมนูของงวดที่ปิด อ่านจากสมุดรายได้ ไม่ได้บวกตารางต้นทาง
  imports: [AddonModule, RevenueModule],
  providers: [PeriodCloseService, PrismaService],
  controllers: [PeriodCloseController],
  exports: [PeriodCloseService],
})
export class PeriodCloseModule {}
