import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { AddonPurchaseController } from './addon-purchase.controller';
import { AddonPurchaseService } from './addon-purchase.service';
import { AddonBillLaterService } from './addon-bill-later.service';
import { PromptPayModule } from '../../promptpay/promptpay.module';

/**
 * ซื้อ add-on รายเดือนแบบ self-service — สิทธิ์ให้ตอนแอดมินแพลตฟอร์มอนุมัติสลิป
 * (grantAddonPurchaseForInvoice ใน PaymentsService.approvePayment) หรือเมื่อ webhook PromptPay ยืนยันยอด
 * ลูกค้าที่มีแพ็กเกจรายเดือน: เปิดใช้ก่อน เก็บรอบบิลถัดไป (AddonBillLaterService)
 */
@Module({
  imports: [PrismaModule, AddonModule, PromptPayModule],
  controllers: [AddonPurchaseController],
  providers: [AddonPurchaseService, AddonBillLaterService],
})
export class AddonPurchaseModule {}
