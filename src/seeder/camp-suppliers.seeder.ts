import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** บัญชีที่ต้องมีซัพพลายเออร์ไว้ทดสอบ flow PR → RFQ → PO */
export const CAMP_SUPPLIER_OWNER_EMAIL = 'premium.camp@email.com';

interface SupplierDef {
  code: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  paymentTerms: string;
  leadTimeDays: number;
  tags: string;
  emoji: string;
  /** สินค้าในคลังที่ผูกกับเจ้านี้ — ขึ้นต้นด้วย SKU เหล่านี้ */
  skuPrefixes: string[];
}

const SUPPLIERS: SupplierDef[] = [
  {
    code: 'CSUP-BEV',
    name: 'ปากช่อง เบเวอเรจ ซัพพลาย',
    contactPerson: 'คุณวิชัย',
    email: 'sales@pakchong-beverage.example.com',
    phone: '044-311-201',
    paymentTerms: 'NET15',
    leadTimeDays: 2,
    tags: 'เครื่องดื่ม,น้ำแข็ง',
    emoji: '🥤',
    skuPrefixes: ['RT-'],
  },
  {
    code: 'CSUP-MAKRO',
    name: 'แม็คโคร โคราช (ขายส่ง)',
    contactPerson: 'ฝ่ายลูกค้าธุรกิจ',
    email: 'b2b@makro-korat.example.com',
    phone: '044-222-555',
    paymentTerms: 'COD',
    leadTimeDays: 1,
    tags: 'ขายส่ง,เครื่องดื่ม,ของใช้',
    emoji: '🛒',
    skuPrefixes: ['RT-', 'GIFT-'],
  },
  {
    code: 'CSUP-GIFT',
    name: 'ดอยดี ของที่ระลึก',
    contactPerson: 'คุณมะลิ',
    email: 'order@doidee-souvenir.example.com',
    phone: '081-456-7788',
    paymentTerms: 'NET30',
    leadTimeDays: 7,
    tags: 'ของที่ระลึก,ของแถม',
    emoji: '🎁',
    skuPrefixes: ['GIFT-'],
  },
  {
    code: 'CSUP-GEAR',
    name: 'แคมป์เปอร์ เกียร์ ไทยแลนด์',
    contactPerson: 'คุณเอก',
    email: 'dealer@camper-gear.example.com',
    phone: '089-222-3344',
    paymentTerms: 'NET30',
    leadTimeDays: 5,
    tags: 'อุปกรณ์แคมป์,เต็นท์',
    emoji: '⛺',
    skuPrefixes: [],
  },
  {
    code: 'CSUP-HW',
    name: 'ปากช่อง วัสดุก่อสร้าง & ฮาร์ดแวร์',
    contactPerson: 'คุณสมศักดิ์',
    email: 'shop@pakchong-hardware.example.com',
    phone: '044-313-909',
    paymentTerms: 'NET15',
    leadTimeDays: 2,
    tags: 'ซ่อมบำรุง,ไฟฟ้า,ประปา',
    emoji: '🔧',
    skuPrefixes: [],
  },
  {
    code: 'CSUP-CLEAN',
    name: 'คลีนโปร ซัพพลาย',
    contactPerson: 'คุณนภา',
    email: 'sales@cleanpro-supply.example.com',
    phone: '086-777-1122',
    paymentTerms: 'NET15',
    leadTimeDays: 3,
    tags: 'ทำความสะอาด,ห้องน้ำ',
    emoji: '🧽',
    skuPrefixes: [],
  },
];

/**
 * ซัพพลายเออร์ของลาน premium.camp — รันซ้ำได้ (เติมเฉพาะที่ยังไม่มี)
 *   npm run seed:camp-suppliers
 */
@Injectable()
export class CampSuppliersSeeder {
  private readonly logger = new Logger(CampSuppliersSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(
    email = CAMP_SUPPLIER_OWNER_EMAIL,
  ): Promise<{ created: number; linked: number } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        tenantId: true,
        userTenants: { select: { tenantId: true, isDefault: true } },
      },
    });
    const tenantId =
      user?.tenantId ??
      user?.userTenants.find((t) => t.isDefault)?.tenantId ??
      user?.userTenants[0]?.tenantId ??
      null;
    if (!tenantId) {
      this.logger.warn(`  ⚠️ ${email}: ไม่พบผู้ใช้หรือกิจการ — ข้ามการเติมซัพพลายเออร์`);
      return null;
    }

    let created = 0;
    let linked = 0;
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, sku: true, sellingPrice: true },
    });

    for (const def of SUPPLIERS) {
      const { skuPrefixes, ...data } = def;
      let supplier = await this.prisma.supplier.findFirst({ where: { tenantId, code: def.code } });
      if (!supplier) {
        supplier = await this.prisma.supplier.create({
          data: { tenantId, ...data, isActive: true },
        });
        created += 1;
        this.logger.log(`  ✓ Supplier: ${def.name}`);
      } else if (!supplier.isActive || supplier.deletedAt) {
        supplier = await this.prisma.supplier.update({
          where: { id: supplier.id },
          data: { isActive: true, deletedAt: null },
        });
      }

      // ผูกสินค้าในคลังกับเจ้าที่ขายของนั้น — ใช้เป็นตัวเลือกแรกตอนขอใบเสนอราคา
      const matched = items.filter((i) => skuPrefixes.some((p) => i.sku.startsWith(p)));
      for (const item of matched) {
        const exists = await this.prisma.itemSupplier.findFirst({
          where: { itemId: item.id, supplierId: supplier.id },
          select: { id: true },
        });
        if (exists) continue;
        const sell = Number(item.sellingPrice ?? 0);
        await this.prisma.itemSupplier.create({
          data: {
            itemId: item.id,
            supplierId: supplier.id,
            // ราคาทุนประมาณ 60% ของราคาขาย (ไม่มีราคาขาย = 100 บาท)
            unitPrice: sell > 0 ? Math.round(sell * 0.6 * 100) / 100 : 100,
            leadDays: def.leadTimeDays,
            isPreferred: skuPrefixes.length === 1,
          },
        });
        linked += 1;
      }
    }

    this.logger.log(`  ✓ ${email}: ซัพพลายเออร์ใหม่ ${created} ราย · ผูกสินค้า ${linked} รายการ`);
    return { created, linked };
  }
}
