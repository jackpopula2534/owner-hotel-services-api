import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RunNightAuditDto } from './dto/run-night-audit.dto';

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

  constructor(private readonly prisma: PrismaService) {}

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

    return { data, total, page, limit };
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

  async close(id: string, tenantId: string, closedBy: string) {
    const audit = await this.findOne(id, tenantId);

    if (audit.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot close audit with status: ${audit.status}. Must be COMPLETED first.`,
      );
    }

    const updated = await this.prisma.nightAudit.update({
      where: { id },
      data: { status: 'CLOSED' },
    });

    this.logger.log(`Night audit ${id} closed by ${closedBy}`);
    return updated;
  }
}
