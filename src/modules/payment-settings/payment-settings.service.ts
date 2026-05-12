import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SavePaymentSettingsDto } from './dto/save-payment-settings.dto';

@Injectable()
export class PaymentSettingsService {
  private readonly logger = new Logger(PaymentSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ดึงการตั้งค่าการชำระเงินของ property
   * ถ้ายังไม่มีจะ return null
   */
  async findByPropertyId(propertyId: string) {
    return this.prisma.paymentSettings.findUnique({
      where: { propertyId },
    });
  }

  /**
   * บันทึก / อัปเดต payment settings (upsert)
   * Return ข้อมูลล่าสุดพร้อม flag isNew
   */
  async upsert(propertyId: string, dto: SavePaymentSettingsDto) {
    const existing = await this.prisma.paymentSettings.findUnique({
      where: { propertyId },
    });

    if (existing) {
      const updated = await this.prisma.paymentSettings.update({
        where: { propertyId },
        data: { ...dto },
      });
      this.logger.log(`Updated payment settings for property: ${propertyId}`);
      return { data: updated, isNew: false };
    }

    const created = await this.prisma.paymentSettings.create({
      data: { propertyId, ...dto },
    });
    this.logger.log(`Created payment settings for property: ${propertyId}`);
    return { data: created, isNew: true };
  }

  /**
   * ตรวจสอบว่า property นี้ setup payment แล้วหรือยัง
   * (สำหรับ onboarding checklist)
   */
  async isSetupComplete(propertyId: string): Promise<boolean> {
    const settings = await this.prisma.paymentSettings.findUnique({
      where: { propertyId },
      select: {
        promptpayEnabled: true,
        bankTransferEnabled: true,
        cashEnabled: true,
      },
    });
    if (!settings) return false;
    // ถือว่า setup แล้ว ถ้าเปิดช่องทางชำระเงินอย่างน้อย 1 ช่องทาง
    return (
      settings.promptpayEnabled ||
      settings.bankTransferEnabled ||
      settings.cashEnabled
    );
  }
}
