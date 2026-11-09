import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RunNightAuditDto } from './dto/run-night-audit.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { resolveAccountIds } from '@/modules/accounting/ledger/posting-accounts.util';
import {
  buildGuestLedgerLines,
  RevenueSummaryRow,
} from '@/modules/accounting/ledger/folio-gl.util';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { bangkokDayRange, toBangkokDate } from '@/common/utils/bangkok-day.util';

export type PreCheckLevel = 'OK' | 'WARN' | 'BLOCK';

export interface PreCheckItem {
  key: string;
  level: PreCheckLevel;
  title: string;
  detail: string;
  count: number;
}

export interface PreCheckResult {
  auditDate: string;
  canRun: boolean;
  items: PreCheckItem[];
}

export interface JournalPreviewLine {
  code: string;
  name: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalPreview {
  auditId: string;
  auditDate: string;
  lines: JournalPreviewLine[];
  summary: Array<RevenueSummaryRow & { name: string }>;
  totalDebit: number;
  totalCredit: number;
  /** ค่าห้องที่เช็คเอาต์ไปแล้ว (รับรู้รายได้ตอนเช็คเอาต์) — ไม่ลงซ้ำใน JE นี้ */
  excludedCount: number;
  excludedAmount: number;
  journalEntry: { id: string; entryNo: string; status: string } | null;
}

interface NightAuditQuery {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class NightAuditService {
  private readonly logger = new Logger(NightAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalEntries: JournalEntriesService,
    private readonly folioPosting: FolioPostingService,
  ) {}

  async findAll(tenantId: string, propertyId: string | undefined, query: NightAuditQuery) {
    const { dateFrom, dateTo, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.auditDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.nightAudit.count({ where }),
      this.prisma.nightAudit.findMany({
        where,
        orderBy: { auditDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const jeIds = data.map((a) => a.journalEntryId).filter((v): v is string => Boolean(v));
    const entries = jeIds.length
      ? await this.prisma.journalEntry.findMany({
          where: { id: { in: jeIds }, tenantId },
          select: { id: true, entryNo: true, status: true },
        })
      : [];
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    const withEntries = data.map((a) => ({
      ...a,
      journalEntry: a.journalEntryId ? (entryMap.get(a.journalEntryId) ?? null) : null,
    }));

    return { data: withEntries, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const audit = await this.prisma.nightAudit.findFirst({
      where: { id, tenantId },
      include: {
        charges: true,
      },
    });
    if (!audit) throw new NotFoundException(`Night audit ${id} not found`);
    return audit;
  }

  async findByDate(tenantId: string, propertyId: string, date: string) {
    const auditDate = new Date(date);
    const audit = await this.prisma.nightAudit.findFirst({
      where: { tenantId, propertyId, auditDate },
      include: { charges: true },
    });
    if (!audit) throw new NotFoundException(`Night audit for date ${date} not found`);
    return audit;
  }

  async run(dto: RunNightAuditDto, tenantId: string, startedBy: string) {
    const auditDateStr = dto.auditDate ?? new Date().toISOString().split('T')[0];
    const auditDate = new Date(auditDateStr);

    // 1. ตรวจว่าวันนั้นยังไม่มี audit
    const existing = await this.prisma.nightAudit.findFirst({
      where: { tenantId, propertyId: dto.propertyId, auditDate },
    });
    if (existing) {
      throw new ConflictException(
        `Night audit for ${auditDateStr} already exists (status: ${existing.status})`,
      );
    }

    // 1.1 ด่านตรวจก่อนรัน — ลิ้นชักยังไม่ปิด / ห้องเลยเวลาเช็คเอาต์ ต้องจัดการก่อน ไม่งั้นยอดวันนี้ไม่ครบ
    const check = await this.preCheck(tenantId, dto.propertyId, auditDateStr);
    const blockers = check.items.filter((i) => i.level === 'BLOCK');
    if (blockers.length > 0) {
      throw new BadRequestException({
        message: `รัน Night Audit ไม่ได้: ${blockers.map((b) => b.title).join(' · ')}`,
        blockers,
      });
    }

    // 1.2 ห้องที่เข้าพักแต่ยังไม่มี folio (เช็คอินก่อนเปิดใช้ระบบบัญชี / event หลุด) — เปิดให้ก่อนลงค่าห้อง
    await this.openMissingFolios(tenantId, dto.propertyId, auditDateStr, startedBy);

    this.logger.log(
      `Running night audit for property ${dto.propertyId} date ${auditDateStr} by ${startedBy}`,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // 2. สร้าง NightAudit record status = IN_PROGRESS
      const nightAudit = await tx.nightAudit.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          auditDate,
          status: 'IN_PROGRESS',
          startedBy,
          startedAt: new Date(),
        },
      });

      // 3. ดึง GuestFolios ที่ OPEN (แขกยังอยู่ ณ วันนั้น)
      const openFolios = await tx.guestFolio.findMany({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          status: 'OPEN',
          checkInDate: { lte: auditDate },
        },
        include: {
          // Every charge the folio has taken since the last audit, not just room
          // nights — F&B and shop charges signed to the room are revenue for the
          // day too, and were previously dropped (fbRevenue was hardcoded to 0).
          charges: { where: { nightAuditId: null, status: 'POSTED' } },
        },
      });

      // ดึง booking ข้อมูลเพื่อคำนวณ room rate
      const bookingIds = openFolios.map((f) => f.bookingId).filter(Boolean) as string[];
      const bookings = bookingIds.length
        ? await tx.booking.findMany({
            where: { id: { in: bookingIds } },
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              totalPrice: true,
              roomSubtotal: true,
            },
          })
        : [];
      const bookingMap = new Map(bookings.map((b) => [b.id, b]));

      // 4. สร้าง NightAuditCharge สำหรับแต่ละ folio
      let roomRevenue = 0;
      let fbRevenue = 0;
      let otherRevenue = 0;
      const sweptChargeIds: string[] = [];
      const chargeCreates: Parameters<typeof tx.nightAuditCharge.create>[0]['data'][] = [];

      for (const folio of openFolios) {
        // Sweep charges posted by other modules (POS, shop) into this audit.
        // They already sit on the folio balance — the audit only classifies them
        // and stamps them so tomorrow's run cannot count them a second time.
        for (const charge of folio.charges) {
          const chargeTotal = Number(charge.totalAmount);
          if (charge.chargeType === 'FB_CHARGE') {
            fbRevenue += chargeTotal;
          } else if (charge.chargeType !== 'ROOM_CHARGE') {
            otherRevenue += chargeTotal;
          } else {
            roomRevenue += chargeTotal;
          }
          sweptChargeIds.push(charge.id);
          chargeCreates.push({
            nightAuditId: nightAudit.id,
            folioId: folio.id,
            bookingId: folio.bookingId ?? '',
            roomId: folio.roomId ?? undefined,
            chargeType: charge.chargeType,
            description: charge.description,
            amount: Number(charge.netAmount),
            vatAmount: Number(charge.vatAmount),
            totalAmount: chargeTotal,
            isPosted: true,
            postedAt: charge.chargeDate,
          });
        }

        const booking = folio.bookingId ? bookingMap.get(folio.bookingId) : undefined;
        let unitPrice = 0;

        if (booking) {
          const nights = Math.max(
            1,
            Math.ceil(
              (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          );
          const baseAmt = booking.roomSubtotal ?? booking.totalPrice;
          unitPrice = Number(baseAmt) / nights;
        }

        const amount = unitPrice;
        const vatAmount = Math.round(amount * 0.07 * 100) / 100;
        const totalAmount = amount + vatAmount;
        roomRevenue += totalAmount;

        chargeCreates.push({
          nightAuditId: nightAudit.id,
          folioId: folio.id,
          bookingId: folio.bookingId ?? '',
          roomId: folio.roomId ?? undefined,
          chargeType: 'ROOM_CHARGE',
          description: `ค่าห้องพักคืน ${auditDateStr}`,
          amount,
          vatAmount,
          totalAmount,
          isPosted: false,
        });

        await tx.folioCharge.create({
          data: {
            tenantId,
            propertyId: dto.propertyId,
            folioId: folio.id,
            chargeDate: auditDate,
            chargeType: 'ROOM_CHARGE',
            description: `ค่าห้องพักคืน ${auditDateStr}`,
            quantity: 1,
            unitPrice: amount,
            netAmount: amount,
            vatRate: 7,
            vatAmount,
            totalAmount,
            nightAuditId: nightAudit.id,
            sourceType: 'NIGHT_AUDIT',
            sourceId: nightAudit.id,
            isAutoPosted: true,
            postedBy: startedBy,
            status: 'POSTED',
          },
        });

        await tx.guestFolio.update({
          where: { id: folio.id },
          data: {
            totalCharges: { increment: totalAmount },
            balance: { increment: totalAmount },
          },
        });
      }

      // Create charges
      if (chargeCreates.length > 0) {
        await tx.nightAuditCharge.createMany({ data: chargeCreates as never[] });
      }

      // Stamp the swept charges so the next run cannot pick them up again.
      if (sweptChargeIds.length > 0) {
        await tx.folioCharge.updateMany({
          where: { id: { in: sweptChargeIds } },
          data: { nightAuditId: nightAudit.id },
        });
      }

      // 6. คำนวณ totalBalance จาก folios
      const folioAgg = await tx.guestFolio.aggregate({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          status: 'OPEN',
          checkInDate: { lte: auditDate },
        },
        _sum: {
          totalCharges: true,
          totalPayments: true,
          balance: true,
        },
      });

      // The loop above already incremented each folio's totalCharges/balance, so
      // the aggregate is current — adding roomRevenue again would double-count it.
      const totalCharges = Number(folioAgg._sum.totalCharges ?? 0);
      const totalPayments = Number(folioAgg._sum.totalPayments ?? 0);
      const totalBalance = Number(folioAgg._sum.balance ?? 0);

      // 7. สถิติห้อง
      const totalRooms = await tx.room.count({ where: { propertyId: dto.propertyId } });
      const occupiedRooms = openFolios.length;
      const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
      const adr = occupiedRooms > 0 ? roomRevenue / occupiedRooms : 0;
      const revPAR = totalRooms > 0 ? roomRevenue / totalRooms : 0;

      // Check-in / Check-out counts ของวันนั้น
      const checkInsCount = await tx.booking.count({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          actualCheckIn: {
            gte: new Date(auditDateStr + 'T00:00:00.000Z'),
            lt: new Date(auditDateStr + 'T23:59:59.999Z'),
          },
        },
      });
      const checkOutsCount = await tx.booking.count({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          actualCheckOut: {
            gte: new Date(auditDateStr + 'T00:00:00.000Z'),
            lt: new Date(auditDateStr + 'T23:59:59.999Z'),
          },
        },
      });

      // 8. อัปเดต NightAudit status = COMPLETED
      const completed = await tx.nightAudit.update({
        where: { id: nightAudit.id },
        data: {
          status: 'COMPLETED',
          roomRevenue,
          fbRevenue,
          otherRevenue,
          totalRevenue: roomRevenue + fbRevenue + otherRevenue,
          totalCharges,
          totalPayments,
          totalBalance,
          totalRooms,
          occupiedRooms,
          occupancyRate,
          adr,
          revPAR,
          checkInsCount,
          checkOutsCount,
          completedBy: startedBy,
          completedAt: new Date(),
        },
        include: { charges: true },
      });

      return completed;
    });

    this.logger.log(`Night audit ${result.id} completed for ${auditDateStr}`);
    return result;
  }

  /**
   * ปิดวัน: สร้าง Journal Entry ของรายได้ทั้งวันจาก FolioCharge ที่ audit นี้กวาดไว้ แล้วล็อก audit
   * postJournal=false → เก็บเป็น DRAFT ให้ฝ่ายบัญชีตรวจก่อนโพสต์จากหน้าสมุดรายวัน
   */
  async close(
    id: string,
    tenantId: string,
    closedBy: string,
    opts: { postJournal?: boolean } = {},
  ) {
    const audit = await this.findOne(id, tenantId);

    if (audit.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot close audit with status: ${audit.status}. Must be COMPLETED first.`,
      );
    }

    const postJournal = opts.postJournal ?? true;
    const preview = await this.journalPreview(id, tenantId);
    let journalEntryId: string | null = audit.journalEntryId ?? null;

    if (!journalEntryId && preview.lines.length > 0) {
      const accountIds = await resolveAccountIds(
        this.prisma,
        tenantId,
        preview.lines.map((l) => l.code),
      );
      const lines = preview.lines.map((l, i) => ({
        accountId: accountIds.get(l.code) as string,
        lineNo: i + 1,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      }));
      const payload = {
        propertyId: audit.propertyId,
        entryDate: preview.auditDate,
        description: `Night Audit ${preview.auditDate} — รายได้ประจำวัน`,
        reference: `NA-${preview.auditDate}`,
        sourceType: JournalSourceTypeEnum.NIGHT_AUDIT,
        sourceId: audit.id,
        lines,
      };
      const entry = postJournal
        ? await this.journalEntries.createAndPostAutoEntry(tenantId, {
            ...payload,
            createdBy: closedBy,
          })
        : await this.journalEntries.create(payload, tenantId, closedBy);
      journalEntryId = entry.id;
    }

    const updated = await this.prisma.nightAudit.update({
      where: { id },
      data: { status: 'CLOSED', journalEntryId },
    });

    this.logger.log(
      `Night audit ${id} closed by ${closedBy}` +
        (journalEntryId
          ? ` — journal ${journalEntryId} (${postJournal ? 'POSTED' : 'DRAFT'})`
          : ' — no revenue'),
    );
    return updated;
  }

  /**
   * ตรวจก่อนรัน (ขั้นที่ 1 บนหน้าจอ) — BLOCK = ต้องแก้ก่อน, WARN = รันได้แต่ควรดู
   */
  async preCheck(tenantId: string, propertyId: string, date?: string): Promise<PreCheckResult> {
    if (!propertyId) throw new BadRequestException('propertyId is required');
    const auditDateStr = date ?? toBangkokDate(new Date());
    const auditDate = new Date(auditDateStr);
    const { end } = bangkokDayRange(auditDateStr);

    const [existing, drawers, overdue, noShows, inHouse, openFolios, pendingFolios, unclosed] =
      await Promise.all([
        this.prisma.nightAudit.findFirst({
          where: { tenantId, propertyId, auditDate },
          select: { status: true },
        }),
        this.prisma.cashDrawer.findMany({
          where: { tenantId, propertyId, status: { in: ['OPEN', 'PENDING'] } },
          select: { code: true, name: true, status: true },
        }),
        this.prisma.booking.findMany({
          where: { tenantId, propertyId, status: 'checked_in', checkOut: { lt: end } },
          select: { bookingNo: true, room: { select: { number: true } } },
          take: 20,
        }),
        this.prisma.booking.count({
          where: { tenantId, propertyId, status: 'confirmed', checkIn: { lt: end } },
        }),
        this.prisma.booking.count({
          where: { tenantId, propertyId, status: 'checked_in', checkIn: { lt: end } },
        }),
        this.prisma.guestFolio.count({ where: { tenantId, propertyId, status: 'OPEN' } }),
        this.prisma.guestFolio.aggregate({
          where: { tenantId, propertyId, status: 'PENDING' },
          _count: { _all: true },
          _sum: { balance: true },
        }),
        this.prisma.nightAudit.count({
          where: { tenantId, propertyId, status: 'COMPLETED', auditDate: { lt: auditDate } },
        }),
      ]);

    const items: PreCheckItem[] = [];
    if (existing) {
      items.push({
        key: 'already-audited',
        level: 'BLOCK',
        title: `วันที่ ${auditDateStr} รัน Night Audit ไปแล้ว`,
        detail: `สถานะ ${existing.status}`,
        count: 1,
      });
    }
    const openDrawers = drawers.filter((d) => d.status === 'OPEN');
    const pendingDrawers = drawers.filter((d) => d.status === 'PENDING');
    items.push(
      openDrawers.length > 0
        ? {
            key: 'cash-drawers-open',
            level: 'BLOCK',
            title: `ลิ้นชักยังไม่ปิดกะ ${openDrawers.length} ลิ้นชัก`,
            detail: openDrawers.map((d) => `${d.code} ${d.name}`).join(', '),
            count: openDrawers.length,
          }
        : pendingDrawers.length > 0
          ? {
              key: 'cash-drawers-open',
              level: 'BLOCK',
              title: `ลิ้นชักรอหัวหน้าอนุมัติปิดกะ ${pendingDrawers.length} ลิ้นชัก`,
              detail: pendingDrawers.map((d) => `${d.code} ${d.name}`).join(', '),
              count: pendingDrawers.length,
            }
          : {
              key: 'cash-drawers-open',
              level: 'OK',
              title: 'ลิ้นชักเงินสดปิดกะครบ',
              detail: 'ยอดเงินสดของวันพร้อมสรุป',
              count: 0,
            },
    );
    items.push(
      overdue.length > 0
        ? {
            key: 'overdue-departures',
            level: 'BLOCK',
            title: `ครบกำหนดเช็คเอาต์แต่ยังไม่ออก ${overdue.length} ห้อง`,
            detail: overdue
              .map((b) => `ห้อง ${b.room?.number ?? '-'} (${b.bookingNo ?? '-'})`)
              .join(', '),
            count: overdue.length,
          }
        : {
            key: 'overdue-departures',
            level: 'OK',
            title: 'ไม่มีห้องค้างเช็คเอาต์',
            detail: '',
            count: 0,
          },
    );
    if (noShows > 0) {
      items.push({
        key: 'no-shows',
        level: 'WARN',
        title: `ยังไม่มาเช็คอิน (No-show) ${noShows} การจอง`,
        detail: 'คิดค่า No-show ลง Folio หรือยกเลิกการจองก่อนปิดวัน',
        count: noShows,
      });
    }
    if (pendingFolios._count._all > 0) {
      items.push({
        key: 'pending-folios',
        level: 'WARN',
        title: `Folio ค้างชำระหลังเช็คเอาต์ ${pendingFolios._count._all} รายการ`,
        detail: `ยอดค้างรวม ${Number(pendingFolios._sum.balance ?? 0).toFixed(2)} บาท — เก็บเงินหรือโอนเข้า City Ledger`,
        count: pendingFolios._count._all,
      });
    }
    if (unclosed > 0) {
      items.push({
        key: 'unclosed-audits',
        level: 'WARN',
        title: `Night Audit วันก่อนหน้ายังไม่ปิด ${unclosed} วัน`,
        detail: 'รายได้ของวันเหล่านั้นยังไม่ลงสมุดรายวัน',
        count: unclosed,
      });
    }
    items.push({
      key: 'in-house',
      level: 'OK',
      title: `ห้องที่เข้าพัก ${inHouse} ห้อง พร้อมลงค่าห้อง`,
      detail: `Folio เปิดอยู่ ${openFolios} รายการ — ห้องที่ยังไม่มี Folio ระบบจะเปิดให้ตอนรัน`,
      count: inHouse,
    });

    return {
      auditDate: auditDateStr,
      canRun: !items.some((i) => i.level === 'BLOCK'),
      items,
    };
  }

  /**
   * ร่าง Journal Entry ของ audit — ใช้ทั้งแสดงบนหน้าจอและตอนปิดวัน (ตัวเลขชุดเดียวกัน)
   * ค่าห้องของการจองที่เช็คเอาต์ไปแล้วถูกรับรู้รายได้ตอนเช็คเอาต์ (BOOKING_PAYMENT) จึงไม่ลงซ้ำ
   */
  async journalPreview(id: string, tenantId: string): Promise<JournalPreview> {
    const audit = await this.prisma.nightAudit.findFirst({
      where: { id, tenantId },
      select: { id: true, auditDate: true, journalEntryId: true },
    });
    if (!audit) throw new NotFoundException(`Night audit ${id} not found`);
    const auditDateStr = audit.auditDate.toISOString().slice(0, 10);

    const charges = await this.prisma.folioCharge.findMany({
      where: { tenantId, nightAuditId: id, status: 'POSTED' },
      select: {
        chargeType: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        folio: { select: { bookingId: true } },
      },
    });

    const roomBookingIds = [
      ...new Set(
        charges.filter((c) => c.chargeType === 'ROOM_CHARGE').map((c) => c.folio.bookingId),
      ),
    ];
    const settled = roomBookingIds.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            tenantId,
            sourceType: 'BOOKING_PAYMENT',
            sourceId: { in: roomBookingIds },
            status: 'POSTED',
          },
          select: { sourceId: true },
        })
      : [];
    const settledIds = new Set(settled.map((e) => e.sourceId));
    const isExcluded = (c: (typeof charges)[number]): boolean =>
      c.chargeType === 'ROOM_CHARGE' && settledIds.has(c.folio.bookingId);

    const included = charges.filter((c) => !isExcluded(c));
    const excluded = charges.filter(isExcluded);
    const { lines, summary } = buildGuestLedgerLines(
      included.map((c) => ({
        chargeType: c.chargeType,
        netAmount: Number(c.netAmount),
        vatAmount: Number(c.vatAmount),
        totalAmount: Number(c.totalAmount),
      })),
      `Night Audit ${auditDateStr}`,
    );

    const codes = [...new Set([...lines.map((l) => l.code), ...summary.map((r) => r.code)])];
    const accounts = codes.length
      ? await this.prisma.accountChart.findMany({
          where: { tenantId, code: { in: codes } },
          select: { code: true, name: true },
        })
      : [];
    const nameOf = new Map(accounts.map((a) => [a.code, a.name]));
    const journalEntry = audit.journalEntryId
      ? await this.prisma.journalEntry.findFirst({
          where: { id: audit.journalEntryId, tenantId },
          select: { id: true, entryNo: true, status: true },
        })
      : null;

    const round2 = (v: number): number => Math.round(v * 100) / 100;
    return {
      auditId: audit.id,
      auditDate: auditDateStr,
      lines: lines.map((l) => ({ ...l, name: nameOf.get(l.code) ?? l.code })),
      summary: summary.map((r) => ({ ...r, name: nameOf.get(r.code) ?? r.code })),
      totalDebit: round2(lines.reduce((sum, l) => sum + l.debit, 0)),
      totalCredit: round2(lines.reduce((sum, l) => sum + l.credit, 0)),
      excludedCount: excluded.length,
      excludedAmount: round2(excluded.reduce((sum, c) => sum + Number(c.totalAmount), 0)),
      journalEntry,
    };
  }

  /** เปิด folio ให้ห้องที่เข้าพักอยู่แต่ยังไม่มี folio — ทีละรายการ ล้มรายการเดียวไม่ล้มทั้งรอบ */
  private async openMissingFolios(
    tenantId: string,
    propertyId: string,
    auditDateStr: string,
    openedBy: string,
  ): Promise<number> {
    const { end } = bangkokDayRange(auditDateStr);
    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId,
        propertyId,
        status: 'checked_in',
        checkIn: { lt: end },
        guestId: { not: null },
        guestFolios: { none: {} },
      },
      select: { id: true },
    });
    let opened = 0;
    for (const b of bookings) {
      try {
        const res = await this.folioPosting.openFolioForBooking(tenantId, b.id, openedBy);
        if (res?.created) opened += 1;
      } catch (error) {
        this.logger.warn(`Open folio failed for booking ${b.id}: ${(error as Error).message}`);
      }
    }
    if (opened > 0) this.logger.log(`Night audit opened ${opened} missing folios`);
    return opened;
  }
}
