import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ArInvoiceStatus, ArInvoiceType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { round2, toBangkokDate } from '@/common/utils/bangkok-day.util';
import {
  AgingBuckets,
  AgingInvoice,
  StatementInvoiceInput,
  StatementLine,
  StatementReceiptInput,
  buildAging,
  buildStatement,
  toStatementEntries,
} from './ar-statement.math';
import { QueryArStatementCustomersDto, QueryArStatementDto } from './dto/query-ar-statement.dto';

/** ใบที่ไม่นับเป็นหนี้: ร่าง / ยกเลิก / ใบเสนอราคา */
const EXCLUDED_STATUSES: ArInvoiceStatus[] = ['DRAFT', 'VOID'];
const EXCLUDED_TYPES: ArInvoiceType[] = ['PROFORMA'];
const OPEN_STATUSES = ['ISSUED', 'PARTIAL', 'OVERDUE'];

export type StatementCustomerType = 'GUEST' | 'COMPANY';

export interface CustomerKey {
  guestId?: string;
  companyTaxId?: string;
  companyName?: string;
}

export interface StatementCustomer extends CustomerKey {
  customerType: StatementCustomerType;
  name: string;
  taxId: string | null;
  address: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface StatementCustomerSummary extends StatementCustomer {
  invoiceCount: number;
  openInvoiceCount: number;
  outstanding: number;
  overdue: number;
  oldestDueDate: string | null;
}

export interface ArStatement {
  customer: StatementCustomer;
  propertyId: string;
  dateFrom: string;
  dateTo: string;
  asOf: string;
  openingBalance: number;
  lines: StatementLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  /** ผลรวม balance ของใบที่ยังค้างจริง ณ วันนี้ — ไว้เทียบกับ closingBalance */
  outstandingPerInvoices: number;
  /** เงินรับที่ยังไม่ได้ตัดเข้าใบใด (บัญชี 2105) — แสดงเป็นข้อมูล ไม่หักจากยอดค้าง */
  unappliedCredit: number;
  aging: AgingBuckets;
  agingInvoices: AgingInvoice[];
}

const ymd = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
const blank = (field: 'companyName' | 'companyTaxId') => ({
  OR: [{ [field]: null }, { [field]: '' }],
});

@Injectable()
export class ArStatementsService {
  private readonly logger = new Logger(ArStatementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * เงื่อนไขระบุลูกค้า (ใช้ได้ทั้ง ar_invoices และ ar_receipts — ชื่อคอลัมน์ตรงกัน)
   * ใบที่มีข้อมูลบริษัทถือเป็นหนี้ของบริษัท ไม่ใช่ของแขก แม้จะผูก guestId ไว้
   */
  private customerWhere(key: CustomerKey): Prisma.ArInvoiceWhereInput & Prisma.ArReceiptWhereInput {
    if (key.companyTaxId) return { companyTaxId: key.companyTaxId.trim() };
    if (key.companyName) {
      return { companyName: key.companyName.trim(), AND: [blank('companyTaxId')] };
    }
    if (key.guestId) {
      return { guestId: key.guestId, AND: [blank('companyName'), blank('companyTaxId')] };
    }
    throw new BadRequestException('ต้องระบุ guestId หรือ companyTaxId หรือ companyName');
  }

  async getStatement(tenantId: string, query: QueryArStatementDto): Promise<ArStatement> {
    const today = toBangkokDate(new Date());
    const dateTo = query.dateTo ?? today;
    const dateFrom = query.dateFrom ?? `${dateTo.slice(0, 7)}-01`;
    if (dateFrom > dateTo) throw new BadRequestException('dateFrom ต้องไม่เกิน dateTo');

    const key: CustomerKey = {
      guestId: query.guestId,
      companyTaxId: query.companyTaxId,
      companyName: query.companyName,
    };
    const customerWhere = this.customerWhere(key);
    // @db.Date อ่านกลับเป็น UTC midnight → ขอบบนใช้ UTC midnight ของวัน dateTo (lte)
    const toDate = new Date(`${dateTo}T00:00:00.000Z`);

    const invoiceWhere: Prisma.ArInvoiceWhereInput = {
      tenantId,
      propertyId: query.propertyId,
      status: { notIn: EXCLUDED_STATUSES },
      invoiceType: { notIn: EXCLUDED_TYPES },
      ...customerWhere,
    };

    const [invoiceRows, allocationRows, receiptRows] = await Promise.all([
      this.prisma.arInvoice.findMany({
        where: invoiceWhere,
        select: {
          id: true,
          invoiceNo: true,
          invoiceType: true,
          issueDate: true,
          dueDate: true,
          totalAmount: true,
          balance: true,
          status: true,
          refInvoiceId: true,
          notes: true,
          guestId: true,
          companyName: true,
          companyTaxId: true,
          companyAddress: true,
        },
        orderBy: [{ issueDate: 'asc' }, { invoiceNo: 'asc' }],
      }),
      this.prisma.arReceiptAllocation.findMany({
        where: {
          tenantId,
          invoice: invoiceWhere,
          receipt: { tenantId, status: 'CLEARED', receiptDate: { lte: toDate } },
        },
        select: {
          amount: true,
          invoice: { select: { invoiceNo: true } },
          receipt: {
            select: {
              id: true,
              receiptNo: true,
              receiptDate: true,
              method: true,
              reference: true,
              totalAmount: true,
              whtAmount: true,
            },
          },
        },
      }),
      // ใบเสร็จของลูกค้ารายนี้ (ไว้คิดเงินรับที่ยังไม่ได้ตัดเข้าใบ)
      this.prisma.arReceipt.findMany({
        where: { tenantId, propertyId: query.propertyId, status: 'CLEARED', ...customerWhere },
        select: {
          totalAmount: true,
          whtAmount: true,
          allocations: { select: { amount: true } },
        },
      }),
    ]);

    // เลขใบต้นทางของใบลดหนี้ — กรอง tenant เสมอ
    const refIds = [
      ...new Set(invoiceRows.map((i) => i.refInvoiceId).filter((v): v is string => !!v)),
    ];
    const refRows = refIds.length
      ? await this.prisma.arInvoice.findMany({
          where: { tenantId, id: { in: refIds } },
          select: { id: true, invoiceNo: true },
        })
      : [];
    const refNo = new Map(refRows.map((r) => [r.id, r.invoiceNo]));

    const invoices: StatementInvoiceInput[] = invoiceRows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      invoiceType: i.invoiceType,
      issueDate: ymd(i.issueDate),
      dueDate: ymd(i.dueDate),
      totalAmount: Number(i.totalAmount),
      balance: Number(i.balance),
      status: i.status,
      refInvoiceNo: i.refInvoiceId ? (refNo.get(i.refInvoiceId) ?? null) : null,
      notes: i.notes,
    }));

    const byReceipt = new Map<string, StatementReceiptInput>();
    for (const a of allocationRows) {
      const r = a.receipt;
      const existing = byReceipt.get(r.id) ?? {
        id: r.id,
        receiptNo: r.receiptNo,
        receiptDate: ymd(r.receiptDate),
        method: r.method,
        reference: r.reference,
        totalAmount: Number(r.totalAmount),
        whtAmount: Number(r.whtAmount ?? 0),
        allocations: [],
      };
      byReceipt.set(r.id, {
        ...existing,
        allocations: [...existing.allocations, { invoiceNo: a.invoice.invoiceNo, amount: Number(a.amount) }],
      });
    }

    const entries = toStatementEntries(invoices, [...byReceipt.values()]);
    const statement = buildStatement(entries, dateFrom, dateTo);
    const aging = buildAging(invoices, today);

    const unappliedCredit = round2(
      receiptRows.reduce((sum, r) => {
        const settled = Number(r.totalAmount) + Number(r.whtAmount ?? 0);
        const allocated = r.allocations.reduce((s, x) => s + Number(x.amount), 0);
        const left = round2(settled - allocated);
        return left > 0.005 ? sum + left : sum;
      }, 0),
    );

    const customer = await this.resolveCustomer(tenantId, key, invoiceRows);

    return {
      customer,
      propertyId: query.propertyId,
      dateFrom,
      dateTo,
      asOf: today,
      ...statement,
      outstandingPerInvoices: aging.buckets.total,
      unappliedCredit,
      aging: aging.buckets,
      agingInvoices: aging.invoices,
    };
  }

  private async resolveCustomer(
    tenantId: string,
    key: CustomerKey,
    invoices: { companyName: string | null; companyTaxId: string | null; companyAddress: string | null }[],
  ): Promise<StatementCustomer> {
    if (key.companyTaxId || key.companyName) {
      // ข้อมูลบริษัทล่าสุดจากใบแจ้งหนี้ (เรียง issueDate asc → ใบท้ายสุด)
      const latest = [...invoices].reverse().find((i) => i.companyName || i.companyTaxId);
      if (!latest) throw new NotFoundException('ไม่พบใบแจ้งหนี้ของลูกค้ารายนี้');
      return {
        customerType: 'COMPANY',
        companyTaxId: key.companyTaxId,
        companyName: key.companyName ?? latest.companyName ?? undefined,
        name: latest.companyName ?? key.companyName ?? key.companyTaxId ?? '',
        taxId: latest.companyTaxId ?? key.companyTaxId ?? null,
        address: latest.companyAddress ?? null,
      };
    }

    const guest = await this.prisma.guest.findFirst({
      where: { id: key.guestId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        postalCode: true,
        country: true,
        nationalId: true,
      },
    });
    if (!guest) throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    const address = [guest.address, guest.city, guest.postalCode, guest.country]
      .filter(Boolean)
      .join(' ');
    return {
      customerType: 'GUEST',
      guestId: guest.id,
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      taxId: guest.nationalId ?? null,
      address: address || null,
      email: guest.email,
      phone: guest.phone,
    };
  }

  /** รายชื่อลูกค้าที่มียอดค้าง (ค้นหาได้ → รวมรายที่ชำระครบแล้วด้วย) */
  async listCustomers(
    tenantId: string,
    query: QueryArStatementCustomersDto,
  ): Promise<StatementCustomerSummary[]> {
    const today = toBangkokDate(new Date());
    const rows = await this.prisma.arInvoice.findMany({
      where: {
        tenantId,
        propertyId: query.propertyId,
        status: { notIn: EXCLUDED_STATUSES },
        invoiceType: { notIn: [...EXCLUDED_TYPES, 'CREDIT_NOTE'] },
      },
      select: {
        guestId: true,
        companyName: true,
        companyTaxId: true,
        companyAddress: true,
        balance: true,
        status: true,
        dueDate: true,
        guest: { select: { firstName: true, lastName: true, address: true } },
      },
      orderBy: { issueDate: 'desc' },
      take: 5000,
    });

    const groups = new Map<string, StatementCustomerSummary>();
    for (const r of rows) {
      const taxId = r.companyTaxId?.trim() || null;
      const companyName = r.companyName?.trim() || null;
      let id: string;
      let base: StatementCustomer;
      if (taxId) {
        id = `tax:${taxId}`;
        base = {
          customerType: 'COMPANY',
          companyTaxId: taxId,
          name: companyName ?? taxId,
          taxId,
          address: r.companyAddress,
        };
      } else if (companyName) {
        id = `name:${companyName.toLowerCase()}`;
        base = {
          customerType: 'COMPANY',
          companyName,
          name: companyName,
          taxId: null,
          address: r.companyAddress,
        };
      } else if (r.guestId) {
        id = `guest:${r.guestId}`;
        base = {
          customerType: 'GUEST',
          guestId: r.guestId,
          name: r.guest ? `${r.guest.firstName} ${r.guest.lastName}`.trim() : r.guestId,
          taxId: null,
          address: r.guest?.address ?? null,
        };
      } else {
        continue;
      }

      const balance = Number(r.balance);
      const isOpen = OPEN_STATUSES.includes(r.status) && balance > 0.005;
      const due = ymd(r.dueDate);
      const prev = groups.get(id) ?? {
        ...base,
        invoiceCount: 0,
        openInvoiceCount: 0,
        outstanding: 0,
        overdue: 0,
        oldestDueDate: null,
      };
      groups.set(id, {
        ...prev,
        invoiceCount: prev.invoiceCount + 1,
        openInvoiceCount: prev.openInvoiceCount + (isOpen ? 1 : 0),
        outstanding: isOpen ? round2(prev.outstanding + balance) : prev.outstanding,
        overdue: isOpen && due < today ? round2(prev.overdue + balance) : prev.overdue,
        oldestDueDate:
          isOpen && (!prev.oldestDueDate || due < prev.oldestDueDate) ? due : prev.oldestDueDate,
      });
    }

    const term = query.search?.trim().toLowerCase();
    const list = [...groups.values()].filter((c) =>
      term
        ? c.name.toLowerCase().includes(term) || (c.taxId ?? '').toLowerCase().includes(term)
        : c.outstanding > 0,
    );
    list.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, 'th'));
    this.logger.debug(`statement customers tenant=${tenantId} → ${list.length}`);
    return list.slice(0, 200);
  }
}
