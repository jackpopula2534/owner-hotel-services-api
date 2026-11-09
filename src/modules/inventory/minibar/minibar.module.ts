import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { FolioPostingModule } from '@/modules/accounts-receivable/folio-posting/folio-posting.module';
import { RetailSalesModule } from '@/modules/inventory/retail-sales/retail-sales.module';
import { MinibarController } from './minibar.controller';
import { MinibarService } from './minibar.service';

/**
 * ไม่มี provider ท่อขายเป็นของตัวเอง — ดึง RetailSalesService มาใช้ต่อทั้งดุ้น
 * เพื่อให้ยอดมินิบาร์เดินผ่านสต๊อก/โฟลิโอ/สมุดรายได้ ชุดเดียวกับการขายหน้าร้าน
 */
@Module({
  imports: [AddonModule, PrismaModule, FolioPostingModule, RetailSalesModule],
  controllers: [MinibarController],
  providers: [MinibarService],
  exports: [MinibarService],
})
export class MinibarModule {}
