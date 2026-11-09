import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { SourceWarehouseResolver } from './source-warehouse.resolver';
import { WarehouseIssueService } from './warehouse-issue.service';

/**
 * โมดูลเล็ก ๆ ที่พึ่ง Prisma อย่างเดียว — ตั้งใจให้ฝั่งร้านอาหารดึงไปใช้ได้
 * โดยไม่ต้องลาก InventoryModule ทั้งก้อนเข้ามา (ซึ่งจะวนกลับมาหาร้านอาหาร)
 */
@Module({
  imports: [PrismaModule],
  providers: [SourceWarehouseResolver, WarehouseIssueService],
  exports: [SourceWarehouseResolver, WarehouseIssueService],
})
export class SourceWarehouseModule {}
