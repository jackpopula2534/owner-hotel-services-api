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
  RecordPaymentDto,
  UpdateReservationAddonsDto,
  UpdateReservationDto,
} from './dto/reservation.dto';
import { calcAddonTotal, calcLodgingTotal, countNights, type SeasonalRate } from './camp-pricing';
import { CampAccountingService } from './camp-accounting.service';
import {
  RevenuePostingService,
  hasPostableRevenue,
} from '../revenue/revenue-posting.service';
import {
  buildCampRevenueInput,
  CAMP_REVENUE_SELECT,
} from '../revenue/sources/camp-revenue.source';

const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campAccounting: CampAccountingService,
    private readonly revenuePosting: RevenuePostingService,
  ) {}

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

      // ลานเชื่อมต่อระบบคลังกลางหรือไม่ (มี warehouseId) → ถ้าไม่เชื่อม จะไม่บริหารสต็อก:
      // เพิ่ม add-on ได้อิสระเพื่อคิดเงิน ไม่ตรวจคงเหลือ และไม่ตัด stock
      const campground = await tx.campground.findFirst({
        where: { id: dto.campgroundId, ...(tenantId ? { tenantId } : {}) },
        select: { warehouseId: true },
      });
      const stockManaged = Boolean(campground?.warehouseId);

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
        if (stockManaged && addon.stockQty < req.qty) {
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

      // สร้าง line items + ตัด stock (เฉพาะลานที่เชื่อมระบบคลัง)
      for (const item of lineItems) {
        await tx.campReservationAddon.create({
          data: { reservationId: created.id, ...item },
        });
        if (stockManaged) {
          await tx.campAddon.update({
            where: { id: item.addonId },
            data: { stockQty: { decrement: item.qty } },
          });
        }
      }

      this.logger.log(`Reservation created: ${created.id} pitch=${dto.pitchId}`);
      return { success: true, data: created };
    });
  }

  /**
   * แก้ไขการจอง — ย้ายจุด / เปลี่ยนวัน / แก้จำนวนผู้เข้าพักได้
   *
   * เดินตามกติกาเดียวกับ `create()` ทุกข้อ เพราะการแก้ไขเปลี่ยนได้ทั้งจุดกาง
   * ช่วงวัน และจำนวนคน ซึ่งกระทบทั้งการชนกันของคิวและราคา:
   *   • ตรวจจองซ้อนบนจุดปลายทาง (ยกเว้นตัวเอง) ใน transaction เดียวกับที่เขียน
   *   • คิด totalPrice ใหม่จากโซนของจุดปลายทาง + ค่าไฟ + add-on เดิม
   * ถ้าไม่ทำ การย้ายจุดจะทับคิวคนอื่นได้เงียบๆ และยอดเงินจะค้างราคาเดิม
   *
   * หมายเหตุ: การแก้ add-on ทำผ่าน endpoint แยก (ไม่ปนกับ update นี้) — ที่นี่
   * ใช้ line item เดิมมาคิดยอดต่อ ไม่แตะ stock
   */
  async update(id: string, dto: UpdateReservationDto, tenantId?: string) {
    const { addons: _addons, checkIn: checkInRaw, checkOut: checkOutRaw, ...rest } = dto;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: { addonItems: true },
      });
      if (!current) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }
      if (current.status === 'cancelled') {
        throw new BadRequestException('การจองนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้');
      }

      const checkIn = checkInRaw ? new Date(checkInRaw) : current.checkIn;
      const checkOut = checkOutRaw ? new Date(checkOutRaw) : current.checkOut;
      if (checkOut <= checkIn) {
        throw new BadRequestException('checkOut ต้องมากกว่า checkIn');
      }

      const pitchId = dto.pitchId ?? current.pitchId;
      const pitch = await tx.campPitch.findFirst({
        where: { id: pitchId, ...(tenantId ? { tenantId } : {}) },
        include: { zone: true },
      });
      if (!pitch) {
        throw new NotFoundException(`Pitch ${pitchId} not found`);
      }

      const clash = await tx.campReservation.findFirst({
        where: {
          id: { not: id },
          pitchId,
          status: { in: BLOCKING_STATUSES },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException('จุดนี้ถูกจองแล้วในช่วงเวลาที่เลือก');
      }

      const totalPrice = this.computeTotal(
        pitch.zone,
        checkIn,
        checkOut,
        dto.numGuests ?? current.numGuests,
        current.addonItems,
      );
      const { paymentStatus } = this.settlePayment(totalPrice, current.amountPaid);

      const data = await tx.campReservation.update({
        where: { id },
        data: {
          ...rest,
          pitchId,
          zoneId: dto.zoneId ?? pitch.zoneId,
          checkIn,
          checkOut,
          scheduledCheckIn: checkIn,
          scheduledCheckOut: checkOut,
          totalPrice,
          paymentStatus,
        },
      });
      this.logger.log(`Reservation updated: ${id} pitch=${pitchId} total=${totalPrice}`);
      return { success: true, data };
    });
  }

  /**
   * แก้ไขอุปกรณ์เช่า (add-on) ของการจอง — ส่งรายการชุดใหม่มาทั้งชุด (replace ไม่ใช่ patch)
   *
   * แยกจาก `update()` เพราะต้องขยับ stock ซึ่งเป็นผลข้างเคียงที่ย้อนยาก:
   *   • คิด "ส่วนต่าง" เทียบของเดิม แล้วตัด/คืนเฉพาะส่วนต่างนั้น ไม่ใช่คืนทั้งหมดแล้วตัดใหม่
   *     (คืนทั้งหมดก่อนจะทำให้ช่วงกลาง transaction มองเห็นของว่างเกินจริง)
   *   • ตรวจคงเหลือเฉพาะรายการที่ "เพิ่มขึ้น" — ลดจำนวนต้องทำได้เสมอแม้ stock ติดลบอยู่
   *   • ลานที่ไม่ได้เชื่อมคลัง (ไม่มี warehouseId) ไม่เคยตัด stock จึงไม่แตะ stock เลย
   * ราคาคิดใหม่ทั้งก้อนจากโซนปัจจุบัน เพื่อให้ผลลัพธ์ตรงกับ update() เสมอ
   */
  async updateAddons(id: string, dto: UpdateReservationAddonsDto, tenantId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: { addonItems: true, pitch: { include: { zone: true } } },
      });
      if (!current) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }
      if (current.status === 'cancelled') {
        throw new BadRequestException('การจองนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้');
      }
      if (current.status === 'checked_out') {
        throw new BadRequestException('การจองนี้เช็คเอาท์แล้ว ไม่สามารถแก้อุปกรณ์เช่าได้');
      }

      // รวมรายการซ้ำ addonId เดียวกันก่อน ไม่งั้นตัด stock สองรอบแต่เก็บ line เดียว
      const requested = new Map<string, number>();
      for (const req of dto.addons) {
        requested.set(req.addonId, (requested.get(req.addonId) ?? 0) + req.qty);
      }

      const campground = await tx.campground.findFirst({
        where: { id: current.campgroundId, ...(tenantId ? { tenantId } : {}) },
        select: { warehouseId: true },
      });
      const stockManaged = Boolean(campground?.warehouseId);

      const existingByAddon = new Map(current.addonItems.map((item) => [item.addonId, item]));
      const lineItems: { addonId: string; name: string; qty: number; priceSnapshot: number }[] = [];

      for (const [addonId, qty] of requested) {
        const addon = await tx.campAddon.findFirst({
          where: { id: addonId, ...(tenantId ? { tenantId } : {}) },
        });
        const existing = existingByAddon.get(addonId);
        // อุปกรณ์ที่ถูกปิดใช้งานไปแล้วยังคงอยู่ในบิลเดิมได้ แต่ห้ามเพิ่มจำนวน
        if (!addon || (!addon.active && !existing)) {
          throw new NotFoundException(`Addon ${addonId} not found`);
        }
        const delta = qty - (existing?.qty ?? 0);
        if (!addon.active && delta > 0) {
          throw new ConflictException(`อุปกรณ์ "${addon.name}" ถูกปิดใช้งานแล้ว เพิ่มจำนวนไม่ได้`);
        }
        if (stockManaged && delta > 0 && addon.stockQty < delta) {
          throw new ConflictException(
            `อุปกรณ์ "${addon.name}" คงเหลือไม่พอ (ต้องเพิ่มอีก ${delta} เหลือ ${addon.stockQty})`,
          );
        }
        lineItems.push({
          addonId,
          name: addon.name,
          qty,
          // รายการเดิมคงราคาที่ตกลงกันไว้ตอนจอง — ขึ้นราคาย้อนหลังกับลูกค้าไม่ได้
          priceSnapshot: existing ? Number(existing.priceSnapshot) : Number(addon.pricePerUnit),
        });
      }

      const totalPrice = this.computeTotal(
        current.pitch.zone,
        current.checkIn,
        current.checkOut,
        current.numGuests,
        lineItems,
      );
      const { paymentStatus } = this.settlePayment(totalPrice, current.amountPaid);

      // ── เขียนผล: ปรับ stock ตามส่วนต่าง แล้ว replace line items ──
      if (stockManaged) {
        for (const item of lineItems) {
          const delta = item.qty - (existingByAddon.get(item.addonId)?.qty ?? 0);
          if (delta !== 0) {
            await tx.campAddon.update({
              where: { id: item.addonId },
              data: { stockQty: { decrement: delta } },
            });
          }
        }
        // รายการที่ถูกถอดออกทั้งหมด — คืนเข้าคลังเต็มจำนวน
        for (const item of current.addonItems) {
          if (!requested.has(item.addonId)) {
            await tx.campAddon.update({
              where: { id: item.addonId },
              data: { stockQty: { increment: item.qty } },
            });
          }
        }
      }

      await tx.campReservationAddon.deleteMany({ where: { reservationId: id } });
      for (const item of lineItems) {
        await tx.campReservationAddon.create({ data: { reservationId: id, ...item } });
      }

      const data = await tx.campReservation.update({
        where: { id },
        data: { totalPrice, paymentStatus },
        include: { addonItems: true },
      });
      this.logger.log(
        `Reservation addons updated: ${id} items=${lineItems.length} total=${totalPrice}`,
      );
      return { success: true, data };
    });
  }

  /** คิดยอดรวม: ค่าที่พัก (+ ต่อคนถ้าโซนคิดแบบ per_person) + ค่าไฟต่อคืน + อุปกรณ์เช่า */
  private computeTotal(
    zone: {
      basePrice: Prisma.Decimal | number;
      weekendPrice: Prisma.Decimal | number | null;
      pricingMode: string | null;
      hasElectricity: boolean | null;
      electricityFee: Prisma.Decimal | number | null;
      seasonalRates?: unknown;
    },
    checkIn: Date,
    checkOut: Date,
    numGuests: number,
    addonItems: { qty: number; priceSnapshot: Prisma.Decimal | number }[],
  ): number {
    const perUnitLodging = calcLodgingTotal(
      Number(zone.basePrice),
      zone.weekendPrice ? Number(zone.weekendPrice) : null,
      checkIn,
      checkOut,
      this.parseSeasons(zone.seasonalRates),
    );
    const lodging = zone.pricingMode === 'per_person' ? perUnitLodging * numGuests : perUnitLodging;
    const electricity =
      zone.hasElectricity && zone.electricityFee
        ? Number(zone.electricityFee) * countNights(checkIn, checkOut)
        : 0;
    return (
      lodging +
      electricity +
      calcAddonTotal(
        addonItems.map((item) => ({ qty: item.qty, priceSnapshot: Number(item.priceSnapshot) })),
      )
    );
  }

  /**
   * เทียบยอดใหม่กับเงินที่รับมาแล้ว
   * ลดยอดต่ำกว่าที่รับชำระไม่ได้ — ระบบไม่มีทางคืนเงินอัตโนมัติ ปล่อยผ่านจะได้
   * ยอดคงค้างติดลบและสถานะการชำระที่อธิบายไม่ได้
   */
  private settlePayment(
    totalPrice: number,
    amountPaid: Prisma.Decimal | number | null,
  ): { paid: number; paymentStatus: string } {
    const paid = Number(amountPaid ?? 0);
    if (totalPrice < paid) {
      throw new BadRequestException(
        `ยอดใหม่ (${totalPrice.toFixed(2)} บาท) ต่ำกว่ายอดที่รับชำระมาแล้ว (${paid.toFixed(2)} บาท) — ต้องคืนเงินก่อนแก้ไข`,
      );
    }
    return { paid, paymentStatus: paid >= totalPrice ? 'paid' : paid > 0 ? 'partial' : 'pending' };
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

      // แขกออกแล้ว = รายได้เกิดแล้ว ลงสมุดในทรานแซกชันเดียวกับการปิดการจอง
      await this.recordCampRevenue(tx, id, reservation.campgroundId);

      return reservation;
    });
    return { success: true, data };
  }

  /**
   * ลงการจองที่เพิ่งเช็คเอาต์เข้าสมุดรายได้กลาง
   *
   * อ่านการจองกลับมาใหม่เพราะต้องได้ `addonItems` มาแยกค่าที่พักออกจากค่าเช่าอุปกรณ์
   * (คนละแผนกในผังบัญชี) และต้องเป็นแถวชุดเดียวกับที่สคริปต์ backfill อ่าน ไม่งั้น
   * ยอดที่ลงตอนเช็คเอาต์กับยอดที่ backfill ย้อนหลังจะไม่ตรงกันโดยไม่มีอะไรฟ้อง
   *
   * การจองยอดศูนย์ (คอมพลิเมนต์/แลกแต้ม) ข้ามเงียบ ๆ — เช็คเอาต์ต้องไม่พังเพราะไม่มีเงิน
   */
  private async recordCampRevenue(
    tx: Prisma.TransactionClient,
    reservationId: string,
    campgroundId: string,
  ): Promise<void> {
    const [row, campground] = await Promise.all([
      tx.campReservation.findFirst({
        where: { id: reservationId },
        select: CAMP_REVENUE_SELECT,
      }),
      tx.campground.findFirst({ where: { id: campgroundId }, select: { name: true } }),
    ]);
    if (!row) return;

    const revenue = buildCampRevenueInput(row, {
      campgroundId,
      campgroundName: campground?.name ?? null,
    });
    if (!hasPostableRevenue(revenue)) return;

    await this.revenuePosting.postWithin(tx, revenue);
  }

  async cancel(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.campReservation.findUniqueOrThrow({
        where: { id },
        include: { addonItems: true },
      });
      // คืน stock อุปกรณ์เช่ากลับคลัง — เฉพาะลานที่เชื่อมระบบคลัง
      // (ลานที่ไม่บริหารคลังไม่เคยตัด stock ตอนจอง จึงไม่ต้องคืน)
      const campground = await tx.campground.findFirst({
        where: { id: reservation.campgroundId },
        select: { warehouseId: true },
      });
      if (campground?.warehouseId) {
        for (const item of reservation.addonItems) {
          await tx.campAddon.update({
            where: { id: item.addonId },
            data: { stockQty: { increment: item.qty } },
          });
        }
      }
      // การจองที่เช็คเอาต์ไปแล้วแล้วถูกยกเลิกทีหลังมีรายได้ค้างอยู่ในสมุด ต้องดึงกลับ
      // ด้วย ไม่งั้นยอดขายของลานจะค้างอยู่ทั้งที่คืนเงินไปแล้ว (ยังไม่เคยลง = คืน 0)
      if (reservation.tenantId) {
        await this.revenuePosting.voidWithin(tx, {
          tenantId: reservation.tenantId,
          sourceType: 'CAMP_RESERVATION',
          sourceId: id,
          voidedBy: 'system',
          reason: 'ยกเลิกการจอง',
        });
      }

      return tx.campReservation.update({
        where: { id },
        data: { status: 'cancelled' },
      });
    });
    return { success: true, data };
  }

  /**
   * รับชำระเงินจริง — บันทึกยอดที่รับเข้ามาแบบสะสม แล้วอัปเดตสถานะการชำระ
   * paid เมื่อยอดสะสม >= totalPrice, partial เมื่อ > 0, ไม่งั้น pending
   */
  async recordPayment(id: string, dto: RecordPaymentDto, tenantId?: string) {
    const reservation = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        amountPaid: true,
        payments: true,
        reservationNo: true,
      },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    if (reservation.status === 'cancelled') {
      throw new BadRequestException('การจองนี้ถูกยกเลิกแล้ว ไม่สามารถรับชำระได้');
    }

    const total = Number(reservation.totalPrice);
    const currentPaid = Number(reservation.amountPaid ?? 0);
    const remaining = Math.round((total - currentPaid) * 100) / 100;

    if (remaining <= 0) {
      throw new BadRequestException('การจองนี้ชำระครบแล้ว');
    }
    if (dto.amount > remaining) {
      throw new BadRequestException(`รับชำระเกินยอดคงค้าง (คงเหลือ ${remaining.toFixed(2)} บาท)`);
    }

    const newPaid = Math.round((currentPaid + dto.amount) * 100) / 100;
    const paymentStatus = newPaid >= total ? 'paid' : newPaid > 0 ? 'partial' : 'pending';

    // เก็บประวัติการชำระแบบรายการ (append เข้า payments JSON)
    const history = this.parsePayments(reservation.payments);
    const record = {
      at: new Date().toISOString(),
      amount: Math.round(dto.amount * 100) / 100,
      method: dto.method,
      ...(dto.reference ? { reference: dto.reference } : {}),
      ...(dto.slipUrl ? { slipUrl: dto.slipUrl } : {}),
      ...(dto.note ? { note: dto.note } : {}),
    };
    const payments = [...history, record];

    const data = await this.prisma.campReservation.update({
      where: { id },
      data: {
        amountPaid: newPaid,
        paymentMethod: dto.method,
        paymentStatus,
        payments: payments as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log(
      `Payment recorded: ${id} +${dto.amount} (${dto.method}) → ${paymentStatus} ${newPaid}/${total}`,
    );

    // ลงบัญชีหลังบันทึกสำเร็จแล้ว — ไม่บล็อกการรับเงิน ถ้าผังบัญชียังไม่ได้ seed ก็แค่ข้าม
    if (tenantId) {
      this.campAccounting
        .postPaymentJournal({
          tenantId,
          reservationId: id,
          reservationNo: reservation.reservationNo,
          amount: record.amount,
          paymentSeq: payments.length,
          paidAt: new Date(record.at),
        })
        .catch((err: Error) => {
          this.logger.warn(`Accounting journal skipped for camp payment ${id}: ${err.message}`);
        });
    }

    return { success: true, data };
  }

  /**
   * อัปโหลดสลิปการโอนเงินแล้วคืน URL — ใช้ก่อนเรียก recordPayment เพื่อแนบ slipUrl
   * (เก็บไฟล์ผ่าน multer ใน controller; ที่นี่แค่ตรวจสิทธิ์เข้าถึงการจอง)
   */
  async attachSlipUrl(id: string, slipUrl: string, tenantId?: string) {
    const reservation = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!reservation) {
      throw new NotFoundException(`Reservation ${id} not found`);
    }
    return { success: true, data: { slipUrl } };
  }

  /** แปลงค่า payments (Json จาก DB) เป็น array อย่างปลอดภัย */
  private parsePayments(raw: unknown): Record<string, unknown>[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object');
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
