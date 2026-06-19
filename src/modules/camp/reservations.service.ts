import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReservationDto,
  UpdateReservationDto,
} from './dto/reservation.dto';
import { calcAddonTotal, calcLodgingTotal, countNights, type SeasonalRate } from './camp-pricing';

const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: { campgroundId?: string; status?: string }, tenantId?: string) {
    if (!tenantId) {
      return { success: true, data: [] };
    }
    const where: Prisma.CampReservationWhereInput = { tenantId };
    if (query.campgroundId) where.campgroundId = query.campgroundId;
    if (query.status) where.status = query.status;

    const data = await this.prisma.campReservation.findMany({
      where,
      orderBy: { checkIn: 'desc' },
      include: {
        pitch: { select: { id: true, code: true, zoneId: true } },
      },
    });
    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const reservation = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { pitch: { include: { zone: true } }, campground: true, addonItems: true },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return { success: true, data: reservation };
  }

  async create(dto: CreateReservationDto, tenantId?: string) {
    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);
    if (checkOut <= checkIn) {
      throw new BadRequestException('checkOut ต้องมากกว่า checkIn');
    }

    // ป้องกันจองซ้อนด้วย transaction
    return this.prisma.$transaction(async (tx) => {
      const pitch = await tx.campPitch.findFirst({
        where: { id: dto.pitchId, ...(tenantId ? { tenantId } : {}) },
        include: { zone: true },
      });
      if (!pitch) {
        throw new NotFoundException(`Pitch ${dto.pitchId} not found`);
      }

      const clash = await tx.campReservation.findFirst({
        where: {
          pitchId: dto.pitchId,
          status: { in: BLOCKING_STATUSES },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException('จุดนี้ถูกจองแล้วในช่วงเวลาที่เลือก');
      }

      // ── ตรวจ add-on + stock แล้วเตรียม line items (snapshot ราคาจาก DB) ──
      const lineItems: {
        addonId: string;
        name: string;
        qty: number;
        priceSnapshot: number;
      }[] = [];
      for (const req of dto.addons ?? []) {
        const addon = await tx.campAddon.findFirst({
          where: { id: req.addonId, ...(tenantId ? { tenantId } : {}) },
        });
        if (!addon || !addon.active) {
          throw new NotFoundException(`Addon ${req.addonId} not found`);
        }
        if (addon.stockQty < req.qty) {
          throw new ConflictException(`อุปกรณ์ "${addon.name}" คงเหลือไม่พอ (เหลือ ${addon.stockQty})`);
        }
        lineItems.push({
          addonId: addon.id,
          name: addon.name,
          qty: req.qty,
          priceSnapshot: Number(addon.pricePerUnit),
        });
      }

      const perUnitLodging = calcLodgingTotal(
        Number(pitch.zone.basePrice),
        pitch.zone.weekendPrice ? Number(pitch.zone.weekendPrice) : null,
        checkIn,
        checkOut,
        this.parseSeasons((pitch.zone as any).seasonalRates),
      );
      // per_person: ราคาที่กำหนดเป็นราคา "ต่อคน" → คูณจำนวนผู้เข้าพัก
      const numGuests = dto.numGuests ?? 1;
      const lodging =
        pitch.zone.pricingMode === 'per_person' ? perUnitLodging * numGuests : perUnitLodging;
      // ค่าไฟ (ถ้าโซนมีไฟฟ้า + ตั้งค่าธรรมเนียม) คิดต่อคืน
      const nights = countNights(checkIn, checkOut);
      const electricity =
        pitch.zone.hasElectricity && pitch.zone.electricityFee
          ? Number(pitch.zone.electricityFee) * nights
          : 0;
      const totalPrice = lodging + electricity + calcAddonTotal(lineItems);

      const created = await tx.campReservation.create({
        data: {
          tenantId: tenantId ?? null,
          campgroundId: dto.campgroundId,
          zoneId: dto.zoneId ?? pitch.zoneId,
          pitchId: dto.pitchId,
          reservationNo: this.generateReservationNo(),
          guestFirstName: dto.guestFirstName,
          guestLastName: dto.guestLastName ?? null,
          guestEmail: dto.guestEmail ?? null,
          guestPhone: dto.guestPhone ?? null,
          checkIn,
          checkOut,
          scheduledCheckIn: checkIn,
          scheduledCheckOut: checkOut,
          numGuests: dto.numGuests ?? 1,
          numTents: dto.numTents ?? 1,
          numVehicles: dto.numVehicles ?? 0,
          hasPet: dto.hasPet ?? false,
          status: 'pending',
          totalPrice,
          notes: dto.notes ?? null,
        },
      });

      // สร้าง line items + ตัด stock
      for (const item of lineItems) {
        await tx.campReservationAddon.create({
          data: { reservationId: created.id, ...item },
        });
        await tx.campAddon.update({
          where: { id: item.addonId },
          data: { stockQty: { decrement: item.qty } },
        });
      }

      this.logger.log(`Reservation created: ${created.id} pitch=${dto.pitchId}`);
      return { success: true, data: created };
    });
  }

  async update(id: string, dto: UpdateReservationDto, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    // หมายเหตุ: การแก้ add-on ทำผ่าน endpoint แยก (ไม่ปนกับ update นี้)
    const { addons: _addons, checkIn, checkOut, ...rest } = dto;
    const data = await this.prisma.campReservation.update({
      where: { id },
      data: {
        ...rest,
        ...(checkIn ? { checkIn: new Date(checkIn) } : {}),
        ...(checkOut ? { checkOut: new Date(checkOut) } : {}),
      },
    });
    return { success: true, data };
  }

  async checkIn(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.campReservation.update({
        where: { id },
        data: { status: 'checked_in', actualCheckIn: new Date() },
      });
      await tx.campPitch.update({
        where: { id: reservation.pitchId },
        data: { status: 'occupied' },
      });
      return reservation;
    });
    return { success: true, data };
  }

  async checkOut(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.campReservation.update({
        where: { id },
        data: { status: 'checked_out', actualCheckOut: new Date() },
      });
      // จุดเข้าสู่สถานะทำความสะอาดก่อนพร้อมขายใหม่
      await tx.campPitch.update({
        where: { id: reservation.pitchId },
        data: { status: 'cleaning' },
      });
      return reservation;
    });
    return { success: true, data };
  }

  async cancel(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.campReservation.findUniqueOrThrow({
        where: { id },
        include: { addonItems: true },
      });
      // คืน stock อุปกรณ์เช่ากลับคลัง
      for (const item of reservation.addonItems) {
        await tx.campAddon.update({
          where: { id: item.addonId },
          data: { stockQty: { increment: item.qty } },
        });
      }
      return tx.campReservation.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });
    return { success: true, data };
  }

  /** แปลงค่า seasonalRates (Json จาก DB) เป็น SeasonalRate[] อย่างปลอดภัย */
  private parseSeasons(raw: unknown): SeasonalRate[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s): s is SeasonalRate =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as SeasonalRate).start === 'string' &&
          typeof (s as SeasonalRate).end === 'string' &&
          typeof (s as SeasonalRate).price === 'number',
      )
      .map((s) => ({ name: s.name, start: s.start, end: s.end, price: s.price }));
  }

  private generateReservationNo(): string {
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `CMP-${ymd}-${rand}`;
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
  }
}
