import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { toBangkokDate } from '@/common/utils/bangkok-day.util';
import { ArInvoicesService } from './ar-invoices.service';
import { CreateCityLedgerInvoiceDto } from './dto/create-city-ledger-invoice.dto';

/** sourceRef ของบรรทัดใบแจ้งหนี้ที่มาจากการโอน Folio เข้า City Ledger */
export const FOLIO_PAYMENT_REF_PREFIX = 'FOLIO_PAYMENT:';
export const folioPaymentRef = (paymentId: string): string =>
  `${FOLIO_PAYMENT_REF_PREFIX}${paymentId}`;

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface UnbilledCityLedgerItem {
  paymentId: string;
  folioId: string;
  folioNo: string;
  roomNumber: string | null;
  checkInDate: Date;
  checkOutDate: Date | null;
  paymentDate: Date;
  amount: number;
}

export interface UnbilledCityLedgerGroup {
  companyName: string;
  companyTaxId: string | null;
  total: number;
  items: UnbilledCityLedgerItem[];
}

/**
 * ใบแจ้งหนี้รวบยอด City Ledger — วางบิลบริษัทจากยอดที่โอนออกจาก Folio แล้ว
 *
 * ยอดพวกนี้ถูกรับรู้รายได้ไปแล้วตอน Night Audit และย้ายจาก 1103 เข้า 1104 ตอนโอน
 * ใบแจ้งหนี้จึงเป็นเอกสารวางบิล ไม่สร้าง JE ตอนออก (ดู ArInvoicesService.issue)
 * บรรทัดอ้างอิง FolioPayment ผ่าน sourceRef กันวางบิลยอดเดียวกันสองใบ
 */
@Injectable()
export class CityLedgerBillingService {
  private readonly logger = new Logger(CityLedgerBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: ArInvoicesService,
  ) {}

  async listUnbilled(tenantId: string, propertyId: string): Promise<UnbilledCityLedgerGroup[]> {
    if (!propertyId) throw new BadRequestException('propertyId is required');
    const payments = await this.prisma.folioPayment.findMany({
      where: { tenantId, propertyId, method: 'CITY_LEDGER', isReversed: false },
      include: {
        folio: {
          select: {
            id: true,
            folioNo: true,
            checkInDate: true,
            checkOutDate: true,
            booking: { select: { room: { select: { number: true } } } },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });
    if (payments.length === 0) return [];

    const billed = await this.billedRefs(
      tenantId,
      payments.map((p) => folioPaymentRef(p.id)),
    );
    const groups = new Map<string, UnbilledCityLedgerGroup>();
    for (const p of payments) {
      if (billed.has(folioPaymentRef(p.id))) continue;
      const company = (p.payerName ?? '').trim() || 'ไม่ระบุบริษัท';
      const taxId = p.reference?.startsWith('TAX:') ? p.reference.slice(4) : null;
      const group = groups.get(company) ?? {
        companyName: company,
        companyTaxId: taxId,
        total: 0,
        items: [],
      };
      groups.set(company, {
        ...group,
        companyTaxId: group.companyTaxId ?? taxId,
        total: round2(group.total + Number(p.amount)),
        items: [
          ...group.items,
          {
            paymentId: p.id,
            folioId: p.folio.id,
            folioNo: p.folio.folioNo,
            roomNumber: p.folio.booking?.room?.number ?? null,
            checkInDate: p.folio.checkInDate,
            checkOutDate: p.folio.checkOutDate,
            paymentDate: p.paymentDate,
            amount: Number(p.amount),
          },
        ],
      });
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }

  async createInvoice(dto: CreateCityLedgerInvoiceDto, tenantId: string, createdBy: string) {
    const ids = [...new Set(dto.folioPaymentIds)];
    const payments = await this.prisma.folioPayment.findMany({
      where: { tenantId, id: { in: ids }, method: 'CITY_LEDGER', isReversed: false },
      include: {
        folio: {
          select: {
            id: true,
            folioNo: true,
            propertyId: true,
            checkInDate: true,
            checkOutDate: true,
            booking: { select: { room: { select: { number: true } } } },
          },
        },
      },
      orderBy: { paymentDate: 'asc' },
    });
    if (payments.length !== ids.length) {
      throw new BadRequestException('มีรายการที่ไม่ใช่ยอดโอน City Ledger หรือถูกยกเลิกแล้ว');
    }
    if (payments.some((p) => p.folio.propertyId !== dto.propertyId)) {
      throw new BadRequestException('รายการต้องมาจากสาขาเดียวกับใบแจ้งหนี้');
    }
    const billed = await this.billedRefs(tenantId, ids.map(folioPaymentRef));
    if (billed.size > 0) {
      throw new BadRequestException('มีรายการที่วางบิลไปแล้วในใบแจ้งหนี้ใบอื่น');
    }

    // แยก VAT ตามสัดส่วนจริงของ folio นั้น (ยอดโอนเป็นยอดรวม VAT แล้ว)
    const folioIds = [...new Set(payments.map((p) => p.folio.id))];
    const ratios = await this.vatRatios(tenantId, folioIds);
    const lines = payments.map((p, i) => {
      const total = round2(Number(p.amount));
      const vat = round2(total * (ratios.get(p.folio.id) ?? 0));
      const net = round2(total - vat);
      const room = p.folio.booking?.room?.number;
      const stay = `${toBangkokDate(p.folio.checkInDate)}${p.folio.checkOutDate ? ` – ${toBangkokDate(p.folio.checkOutDate)}` : ''}`;
      return {
        lineNo: i + 1,
        description: `${room ? `ห้อง ${room} · ` : ''}${stay}`,
        chargeType: 'OTHER' as const,
        quantity: 1,
        unitPrice: net,
        discountAmt: 0,
        netAmount: net,
        vatRate: net > 0 ? round2((vat / net) * 100) : 0,
        vatAmount: vat,
        totalAmount: total,
        sourceRef: folioPaymentRef(p.id),
      };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.netAmount, 0));
    const vatAmount = round2(lines.reduce((s, l) => s + l.vatAmount, 0));
    const totalAmount = round2(subtotal + vatAmount);

    const today = toBangkokDate(new Date());
    const issueDate = new Date(`${today}T00:00:00.000Z`);
    const dueDate = new Date(issueDate.getTime() + (dto.creditDays ?? 30) * 86_400_000);
    const invoiceNo = await this.invoices.generateInvoiceNo(tenantId);

    const invoice = await this.prisma.arInvoice.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        invoiceNo,
        invoiceType: 'CITY_LEDGER',
        status: 'DRAFT',
        companyName: dto.companyName,
        companyTaxId: dto.companyTaxId ?? null,
        companyAddress: dto.companyAddress ?? null,
        issueDate,
        dueDate,
        subtotal,
        taxableAmount: subtotal,
        vatAmount,
        totalAmount,
        paidAmount: 0,
        balance: totalAmount,
        notes: `รวบยอดจาก Folio ${[...new Set(payments.map((p) => p.folio.folioNo))].join(', ')}`,
        createdBy,
        lines: { create: lines },
      },
      include: { lines: true },
    });
    this.logger.log(
      `City Ledger invoice ${invoiceNo} drafted from ${payments.length} folio transfers`,
    );
    return invoice;
  }

  private async billedRefs(tenantId: string, refs: string[]): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    const lines = await this.prisma.arInvoiceLine.findMany({
      where: { sourceRef: { in: refs }, invoice: { tenantId, status: { not: 'VOID' } } },
      select: { sourceRef: true },
    });
    return new Set(lines.map((l) => l.sourceRef as string));
  }

  /** สัดส่วน VAT ต่อยอดรวมของแต่ละ folio (จาก charge ที่ยัง POSTED) */
  private async vatRatios(tenantId: string, folioIds: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.folioCharge.groupBy({
      by: ['folioId'],
      where: { tenantId, folioId: { in: folioIds }, status: 'POSTED' },
      _sum: { vatAmount: true, totalAmount: true },
    });
    return new Map(
      rows.map((r) => {
        const total = Number(r._sum.totalAmount ?? 0);
        return [r.folioId, total > 0 ? Number(r._sum.vatAmount ?? 0) / total : 0];
      }),
    );
  }
}
