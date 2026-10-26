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
  AddExtraChargeDto,
  CancelReservationDto,
  CheckInReservationDto,
  CheckOutReservationDto,
  CreateReservationDto,
  RecordPaymentDto,
  UpdateReservationAddonsDto,
  UpdateReservationDto,
} from './dto/reservation.dto';
import {
  baht,
  chargesJson,
  extraChargesTotal,
  guestName,
  logOpsEvent,
  newCharge,
  parseExtraCharges,
} from './camp-ops-shared';
import { calcAddonTotal, quoteCampStay } from './camp-pricing';
import { CampAccountingService } from './camp-accounting.service';
import { RevenuePostingService, hasPostableRevenue } from '../revenue/revenue-posting.service';
import { buildCampRevenueInput, CAMP_REVENUE_SELECT } from '../revenue/sources/camp-revenue.source';
import { LoyaltyService } from '../../loyalty/loyalty.service';

const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campAccounting: CampAccountingService,
    private readonly revenuePosting: RevenuePostingService,
    private readonly loyalty: LoyaltyService,
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

  /**
   * opts.source: ที่มาของการจอง — หน้าเว็บของลานส่ง 'WEBSITE' ที่เหลือเป็นพนักงานลงเอง
   * opts.guestId: แขกสมาชิกที่จับคู่ได้ (ผู้เรียกต้องหามาจาก tenant เดียวกันแล้ว) — ใช้สะสมแต้มตอนเช็คเอาต์
   */
  async create(
    dto: CreateReservationDto,
    tenantId?: string,
    opts: { source?: 'STAFF' | 'WEBSITE'; guestId?: string | null; actorId?: string | null } = {},
  ) {
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
          throw new ConflictException(
            `อุปกรณ์ "${addon.name}" คงเหลือไม่พอ (เหลือ ${addon.stockQty})`,
          );
        }
        lineItems.push({
          addonId: addon.id,
          name: addon.name,
          qty: req.qty,
          priceSnapshot: Number(addon.pricePerUnit),
        });
      }

      const totalPrice = this.computeTotal(
        pitch.zone,
        checkIn,
        checkOut,
        dto.numGuests ?? 1,
        lineItems,
      );

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
          source: opts.source ?? 'STAFF',
          guestId: opts.guestId ?? null,
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

      const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
      await logOpsEvent(tx, {
        tenantId,
        campgroundId: dto.campgroundId,
        type: 'booking',
        pitchId: pitch.id,
        reservationId: created.id,
        actorId: opts.actorId,
        message: `จอง ${pitch.code} · ${guestName(created)} · ${nights} คืน${opts.source === 'WEBSITE' ? ' (หน้าเว็บ)' : ''}`,
      });
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
  async update(id: string, dto: UpdateReservationDto, tenantId?: string, actorId?: string | null) {
    const {
      addons: _addons,
      checkIn: checkInRaw,
      checkOut: checkOutRaw,
      waivePriceDifference,
      ...rest
    } = dto;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: { addonItems: true, pitch: { select: { id: true, code: true } } },
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

      const moved = pitchId !== current.pitchId;
      // ย้ายแขกที่อยู่ในลานแล้ว เข้าจุดที่ปิดซ่อม/ปิดขายไม่ได้ (จุดว่างหรือรอทำความสะอาดได้)
      if (moved && current.status === 'checked_in' && ['maintenance', 'closed', 'occupied'].includes(pitch.status)) {
        throw new ConflictException(`จุด ${pitch.code} ยังไม่พร้อมรับแขก`);
      }

      const charges = parseExtraCharges(current.extraCharges);
      const numGuests = dto.numGuests ?? current.numGuests;
      let totalPrice = this.computeTotal(
        pitch.zone,
        checkIn,
        checkOut,
        numGuests,
        current.addonItems,
        extraChargesTotal(charges),
      );
      // ย้ายจุดเพราะลานขอเอง — ใส่ส่วนลดเท่าส่วนต่าง ยอดรวมเท่าเดิม
      const previousTotal = Number(current.totalPrice);
      if (moved && waivePriceDifference && totalPrice > previousTotal) {
        const diff = Math.round((totalPrice - previousTotal) * 100) / 100;
        charges.push(
          newCharge(
            { label: `ไม่คิดส่วนต่างย้าย ${current.pitch.code} → ${pitch.code}`, amount: -diff, kind: 'adjustment' },
            actorId,
          ),
        );
        totalPrice = previousTotal;
      }
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
          extraCharges: chargesJson(charges),
        },
      });

      // แขกอยู่ในลานแล้วย้ายจุด: จุดใหม่มีแขก จุดเดิมรอแม่บ้าน
      if (moved && current.status === 'checked_in') {
        await tx.campPitch.update({ where: { id: pitchId }, data: { status: 'occupied' } });
        await tx.campPitch.update({ where: { id: current.pitchId }, data: { status: 'cleaning' } });
        if (current.tenantId) {
          await tx.campOpsTask.create({
            data: {
              tenantId: current.tenantId,
              campgroundId: current.campgroundId,
              pitchId: current.pitchId,
              reservationId: id,
              type: 'cleaning',
              title: `ทำความสะอาดหลังย้ายแขกไป ${pitch.code}`,
              createdBy: actorId ?? null,
            },
          });
        }
      }

      const extended = checkOut.getTime() !== current.checkOut.getTime();
      if (moved || extended) {
        await logOpsEvent(tx, {
          tenantId: current.tenantId,
          campgroundId: current.campgroundId,
          type: moved ? 'move' : 'extend',
          pitchId,
          reservationId: id,
          actorId,
          message: moved
            ? `ย้าย ${guestName(current)} ${current.pitch.code} → ${pitch.code}`
            : `แก้วันออก ${pitch.code} · ${guestName(current)} → ${checkOut.toISOString().slice(0, 10)}`,
        });
      }
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
  async updateAddons(
    id: string,
    dto: UpdateReservationAddonsDto,
    tenantId?: string,
    actorId?: string | null,
  ) {
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
        extraChargesTotal(parseExtraCharges(current.extraCharges)),
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
      await logOpsEvent(tx, {
        tenantId: current.tenantId,
        campgroundId: current.campgroundId,
        type: 'rentals',
        pitchId: current.pitchId,
        reservationId: id,
        actorId,
        message: `อัปเดตอุปกรณ์เช่า ${current.pitch.code} · ${
          lineItems.length ? lineItems.map((l) => `${l.name}×${l.qty}`).join(', ') : 'ไม่มี'
        }`,
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
    extras = 0,
  ): number {
    const stay = quoteCampStay(zone, checkIn, checkOut, numGuests);
    const total =
      stay.lodging +
      stay.electricity +
      calcAddonTotal(
        addonItems.map((item) => ({ qty: item.qty, priceSnapshot: Number(item.priceSnapshot) })),
      ) +
      extras;
    // ส่วนลดมากกว่ายอด = ยอดศูนย์ ไม่ติดลบ
    return Math.max(0, Math.round(total * 100) / 100);
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

  /**
   * เช็คอิน — รับข้อมูลหน้าเคาน์เตอร์ได้ (ตรวจบัตร, จำนวนคนจริง, ทะเบียนรถ)
   *
   * กันเคสที่ทำให้ฉากหน้าลานเพี้ยน: จุดมีแขกคนอื่นพักอยู่ หรือจุดปิดซ่อม/ปิดขาย
   * จุดที่ยังรอแม่บ้านเช็คอินได้ (หน้างานจริงแขกมาก่อนแม่บ้านเสร็จบ่อย) —
   * งานทำความสะอาดที่ค้างของจุดนั้นปิดให้อัตโนมัติ
   */
  async checkIn(
    id: string,
    tenantId?: string,
    dto: CheckInReservationDto = {},
    actorId?: string | null,
  ) {
    const data = await this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
        include: { addonItems: true, pitch: { include: { zone: true } } },
      });
      if (!current) {
        throw new NotFoundException(`Reservation ${id} not found`);
      }
      if (current.status === 'checked_in') {
        return current;
      }
      if (current.status !== 'pending' && current.status !== 'confirmed') {
        throw new BadRequestException('เช็คอินได้เฉพาะการจองที่ยังไม่เข้าพัก');
      }
      if (current.pitch.status === 'maintenance' || current.pitch.status === 'closed') {
        throw new ConflictException(`จุด ${current.pitch.code} ปิดอยู่ — ย้ายจุดก่อนเช็คอิน`);
      }
      const occupiedBy = await tx.campReservation.findFirst({
        where: { id: { not: id }, pitchId: current.pitchId, status: 'checked_in' },
        select: { guestFirstName: true },
      });
      if (occupiedBy) {
        throw new ConflictException(
          `จุด ${current.pitch.code} ยังมีแขก (${occupiedBy.guestFirstName}) พักอยู่ — เช็คเอาท์หรือย้ายจุดก่อน`,
        );
      }

      const numGuests = dto.numGuests ?? current.numGuests;
      const totalPrice = this.computeTotal(
        current.pitch.zone,
        current.checkIn,
        current.checkOut,
        numGuests,
        current.addonItems,
        extraChargesTotal(parseExtraCharges(current.extraCharges)),
      );
      const { paymentStatus } = this.settlePayment(totalPrice, current.amountPaid);

      const reservation = await tx.campReservation.update({
        where: { id },
        data: {
          status: 'checked_in',
          actualCheckIn: new Date(),
          numGuests,
          totalPrice,
          paymentStatus,
          ...(dto.numVehicles !== undefined ? { numVehicles: dto.numVehicles } : {}),
          ...(dto.vehiclePlate !== undefined ? { vehiclePlate: dto.vehiclePlate.trim() || null } : {}),
          ...(dto.idVerified ? { idVerifiedAt: new Date() } : {}),
        },
      });
      await tx.campPitch.update({
        where: { id: current.pitchId },
        data: { status: 'occupied' },
      });
      if (current.tenantId) {
        await tx.campOpsTask.updateMany({
          where: {
            tenantId: current.tenantId,
            pitchId: current.pitchId,
            type: 'cleaning',
            status: { in: ['open', 'in_progress'] },
          },
          data: { status: 'done', completedAt: new Date(), completedBy: actorId ?? null },
        });
      }
      await logOpsEvent(tx, {
        tenantId: current.tenantId,
        campgroundId: current.campgroundId,
        type: 'check_in',
        pitchId: current.pitchId,
        reservationId: id,
        actorId,
        message: `เช็คอิน ${current.pitch.code} · ${guestName(current)} · ${numGuests} คน${
          dto.vehiclePlate ? ` · ${dto.vehiclePlate.trim()}` : ''
        }`,
      });
      return reservation;
    });
    return { success: true, data };
  }

  /**
   * เช็คเอาท์ — ค่าเสียหาย (ถ้ามี) เข้าบิลก่อนปิด แล้วเปิดงานทำความสะอาดจุดให้แม่บ้าน
   * ยอดค้างไม่บล็อกการเช็คเอาท์ (ลานเก็บเงินทีหลังได้) แต่หน้าจอเตือนก่อนเสมอ
   */
  async checkOut(
    id: string,
    tenantId?: string,
    dto: CheckOutReservationDto = {},
    actorId?: string | null,
  ) {
    await this.ensureExists(id, tenantId);
    const before = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { status: true },
    });
    if (before?.status === 'cancelled') {
      throw new BadRequestException('การจองนี้ถูกยกเลิกแล้ว');
    }
    const firstTime = before?.status !== 'checked_out';
    const data = await this.prisma.$transaction(async (tx) => {
      if (firstTime && dto.damageFee && dto.damageFee > 0) {
        await this.appendCharge(
          tx,
          id,
          { label: dto.damageNote?.trim() || 'ค่าเสียหาย / อุปกรณ์ไม่คืน', amount: dto.damageFee, kind: 'damage' },
          actorId,
        );
      }
      const reservation = await tx.campReservation.update({
        where: { id },
        data: { status: 'checked_out', actualCheckOut: new Date() },
        include: { pitch: { select: { code: true } } },
      });
      // จุดเข้าสู่สถานะทำความสะอาดก่อนพร้อมขายใหม่
      await tx.campPitch.update({
        where: { id: reservation.pitchId },
        data: { status: 'cleaning' },
      });

      if (firstTime && reservation.tenantId) {
        await tx.campOpsTask.create({
          data: {
            tenantId: reservation.tenantId,
            campgroundId: reservation.campgroundId,
            pitchId: reservation.pitchId,
            reservationId: id,
            type: 'cleaning',
            title: 'ทำความสะอาดหลังเช็คเอาท์',
            assigneeName: dto.housekeeperName?.trim() || null,
            status: dto.housekeeperName?.trim() ? 'in_progress' : 'open',
            startedAt: dto.housekeeperName?.trim() ? new Date() : null,
            createdBy: actorId ?? null,
          },
        });
        const balance = Number(reservation.totalPrice) - Number(reservation.amountPaid ?? 0);
        await logOpsEvent(tx, {
          tenantId: reservation.tenantId,
          campgroundId: reservation.campgroundId,
          type: 'check_out',
          pitchId: reservation.pitchId,
          reservationId: id,
          actorId,
          message: `เช็คเอาท์ ${reservation.pitch.code} · ${guestName(reservation)}${
            balance > 0 ? ` · ค้างชำระ ${baht(balance)}` : ''
          }${dto.housekeeperName?.trim() ? ` · มอบหมาย${dto.housekeeperName.trim()}` : ''}`,
        });
      }

      // แขกออกแล้ว = รายได้เกิดแล้ว ลงสมุดในทรานแซกชันเดียวกับการปิดการจอง
      await this.recordCampRevenue(tx, id, reservation.campgroundId);

      const { pitch: _pitch, ...plain } = reservation;
      return plain;
    });
    // แต้มให้หลังทรานแซกชันเท่านั้น และไม่ให้ซ้ำถ้ากดเช็คเอาต์การจองที่ออกไปแล้ว
    if (firstTime) await this.awardStayPoints(data);
    return { success: true, data };
  }

  /** เพิ่มค่าใช้จ่ายเข้าบิล แล้วคิดยอดรวม/สถานะการชำระใหม่ */
  async addCharge(id: string, dto: AddExtraChargeDto, tenantId?: string, actorId?: string | null) {
    if (dto.amount === 0) throw new BadRequestException('จำนวนเงินต้องไม่เป็นศูนย์');
    if (dto.amount < 0 && dto.kind !== 'adjustment') {
      throw new BadRequestException('ยอดติดลบ (ส่วนลด) ใช้ได้กับประเภท "ปรับราคา" เท่านั้น');
    }
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });
      if (current.status === 'cancelled') {
        throw new BadRequestException('การจองนี้ถูกยกเลิกแล้ว');
      }
      return this.appendCharge(tx, id, dto, actorId, true);
    });
    return { success: true, data };
  }

  async removeCharge(id: string, chargeId: string, tenantId?: string, actorId?: string | null) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const current = await tx.campReservation.findUniqueOrThrow({
        where: { id },
        include: { addonItems: true, pitch: { include: { zone: true } } },
      });
      if (current.status === 'checked_out' || current.status === 'cancelled') {
        throw new BadRequestException('ปิดบิลแล้ว แก้ค่าใช้จ่ายไม่ได้');
      }
      const charges = parseExtraCharges(current.extraCharges);
      const target = charges.find((c) => c.id === chargeId);
      if (!target) throw new NotFoundException('ไม่พบรายการค่าใช้จ่ายนี้');
      const rest = charges.filter((c) => c.id !== chargeId);
      const totalPrice = this.computeTotal(
        current.pitch.zone,
        current.checkIn,
        current.checkOut,
        current.numGuests,
        current.addonItems,
        extraChargesTotal(rest),
      );
      const { paymentStatus } = this.settlePayment(totalPrice, current.amountPaid);
      const updated = await tx.campReservation.update({
        where: { id },
        data: { extraCharges: chargesJson(rest), totalPrice, paymentStatus },
      });
      await logOpsEvent(tx, {
        tenantId: current.tenantId,
        campgroundId: current.campgroundId,
        type: 'charge',
        pitchId: current.pitchId,
        reservationId: id,
        actorId,
        message: `ลบค่าใช้จ่าย ${current.pitch.code} · ${target.label} (${baht(target.amount)})`,
      });
      return updated;
    });
    return { success: true, data };
  }

  /** ต่อท้าย extraCharges + คิดยอดใหม่ — ใช้ใน transaction ของผู้เรียก */
  private async appendCharge(
    tx: Prisma.TransactionClient,
    id: string,
    input: { label: string; amount: number; kind?: AddExtraChargeDto['kind'] },
    actorId?: string | null,
    log = false,
  ) {
    const current = await tx.campReservation.findUniqueOrThrow({
      where: { id },
      include: { addonItems: true, pitch: { include: { zone: true } } },
    });
    const charge = newCharge(input, actorId);
    const charges = [...parseExtraCharges(current.extraCharges), charge];
    const totalPrice = this.computeTotal(
      current.pitch.zone,
      current.checkIn,
      current.checkOut,
      current.numGuests,
      current.addonItems,
      extraChargesTotal(charges),
    );
    const { paymentStatus } = this.settlePayment(totalPrice, current.amountPaid);
    const updated = await tx.campReservation.update({
      where: { id },
      data: { extraCharges: chargesJson(charges), totalPrice, paymentStatus },
    });
    if (log) {
      await logOpsEvent(tx, {
        tenantId: current.tenantId,
        campgroundId: current.campgroundId,
        type: 'charge',
        pitchId: current.pitchId,
        reservationId: id,
        actorId,
        message: `เพิ่มค่าใช้จ่าย ${current.pitch.code} · ${charge.label} ${baht(charge.amount)}`,
      });
    }
    return updated;
  }

  /**
   * สะสมแต้มให้แขกสมาชิก (1 แต้ม/100 บาท) — การจองที่ไม่ได้ผูกสมาชิกข้ามเงียบ ๆ
   * LoyaltyService กลืน error เอง แต้มจึงไม่มีวันทำให้เช็คเอาต์ล้ม
   */
  private async awardStayPoints(reservation: {
    id: string;
    tenantId: string | null;
    guestId: string | null;
    totalPrice: Prisma.Decimal | number;
  }): Promise<void> {
    if (!reservation.guestId || !reservation.tenantId) return;
    await this.loyalty.addPointsForStay(
      reservation.guestId,
      reservation.tenantId,
      Number(reservation.totalPrice),
      { bookingId: reservation.id, reason: 'camp_stay' },
    );
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

  /**
   * ยกเลิก / No-show — เก็บเหตุผลไว้ และบันทึกว่าจะทำอะไรกับมัดจำ
   * (ระบบไม่โอนเงินคืนเอง: depositAction เป็นบันทึกให้ฝ่ายบัญชีตามต่อ)
   * ยกเลิกแขกที่อยู่ในลานแล้ว → จุดต้องไปรอแม่บ้าน ไม่ใช่ค้าง "มีแขก"
   */
  async cancel(id: string, tenantId?: string, dto: CancelReservationDto = {}, actorId?: string | null) {
    await this.ensureExists(id, tenantId);
    const data = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.campReservation.findUniqueOrThrow({
        where: { id },
        include: { addonItems: true, pitch: { select: { code: true } } },
      });
      if (reservation.status === 'cancelled') {
        const { pitch: _p, addonItems: _a, ...plain } = reservation;
        return plain;
      }
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

      if (reservation.status === 'checked_in') {
        await tx.campPitch.update({ where: { id: reservation.pitchId }, data: { status: 'cleaning' } });
      }
      const REASON: Record<string, string> = { no_show: 'No-show', guest: 'ลูกค้าขอยกเลิก', camp: 'ลานยกเลิก' };
      const DEPOSIT: Record<string, string> = { keep: 'ริบมัดจำ', refund: 'คืนมัดจำ', credit: 'เก็บเป็นเครดิต' };
      const paid = Number(reservation.amountPaid ?? 0);
      const memo = [
        dto.reason ? REASON[dto.reason] : 'ยกเลิก',
        paid > 0 && dto.depositAction ? `${DEPOSIT[dto.depositAction]} ${baht(paid)}` : null,
        dto.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(' · ');
      await logOpsEvent(tx, {
        tenantId: reservation.tenantId,
        campgroundId: reservation.campgroundId,
        type: 'cancel',
        pitchId: reservation.pitchId,
        reservationId: id,
        actorId,
        message: `${memo} · ${reservation.pitch.code} ${guestName(reservation)}`,
        meta: { reason: dto.reason ?? null, depositAction: dto.depositAction ?? null, amountPaid: paid },
      });

      return tx.campReservation.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelReason: dto.reason ?? null,
          ...(dto.reason || dto.depositAction || dto.note
            ? { notes: [reservation.notes, `[${memo}]`].filter(Boolean).join('\n') }
            : {}),
        },
      });
    });
    return { success: true, data };
  }

  /**
   * รับชำระเงินจริง — บันทึกยอดที่รับเข้ามาแบบสะสม แล้วอัปเดตสถานะการชำระ
   * paid เมื่อยอดสะสม >= totalPrice, partial เมื่อ > 0, ไม่งั้น pending
   */
  async recordPayment(
    id: string,
    dto: RecordPaymentDto,
    tenantId?: string,
    actorId?: string | null,
  ) {
    const reservation = await this.prisma.campReservation.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        amountPaid: true,
        payments: true,
        reservationNo: true,
        paymentRef: true,
        tenantId: true,
        campgroundId: true,
        pitchId: true,
        guestFirstName: true,
        guestLastName: true,
        pitch: { select: { code: true } },
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
    const METHOD: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', qr: 'PromptPay', card: 'บัตร' };
    await logOpsEvent(this.prisma, {
      tenantId: reservation.tenantId,
      campgroundId: reservation.campgroundId,
      type: 'payment',
      pitchId: reservation.pitchId,
      reservationId: id,
      actorId,
      message: `รับชำระ ${reservation.pitch.code} · ${guestName(reservation)} ${baht(dto.amount)} (${
        METHOD[dto.method] ?? dto.method
      })`,
    }).catch((err: Error) => this.logger.warn(`ops event skipped: ${err.message}`));
    this.logger.log(
      `Payment recorded: ${id} +${dto.amount} (${dto.method}) → ${paymentStatus} ${newPaid}/${total}`,
    );

    // ลูกค้าจองผ่านเว็บแล้วโอน QR → พนักงานรับชำระแล้ว = QR นั้นได้รับเงินแล้ว
    // หน้าเว็บของลูกค้าจะเปลี่ยนจาก "รอตรวจสลิป" เป็น "ชำระแล้ว"
    if (reservation.paymentRef && (dto.method === 'qr' || dto.method === 'transfer')) {
      await this.prisma.promptPayTransaction.updateMany({
        where: {
          transactionRef: reservation.paymentRef,
          ...(tenantId ? { tenantId } : {}),
          status: { in: ['pending', 'expired'] },
        },
        data: { status: 'verified', verifiedAt: new Date(), paidAt: new Date() },
      });
    }

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
