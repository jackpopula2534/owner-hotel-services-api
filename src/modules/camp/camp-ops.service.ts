import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokDayRange, businessDateOf, shiftDate, toBangkokDate } from '@/common/utils/bangkok-day.util';
import {
  CreateOpsTaskDto,
  SetFacilityStatusDto,
  SetPitchStatusDto,
  UpdateOpsTaskDto,
} from './dto/camp-ops.dto';
import { guestName, logOpsEvent, parseExtraCharges } from './camp-ops-shared';

const ACTIVE_STAY = ['pending', 'confirmed', 'checked_in'];
const OPEN_TASK = ['open', 'in_progress'];
const MAX_EVENTS = 40;

const PITCH_STATUS_TH: Record<string, string> = {
  available: 'พร้อมขาย',
  cleaning: 'รอทำความสะอาด',
  maintenance: 'ปิดซ่อม',
  closed: 'ปิดใช้งาน',
};
const FACILITY_STATUS_TH: Record<string, string> = { open: 'เปิด', closed: 'ปิดชั่วคราว', maintenance: 'ซ่อม' };

/**
 * งานหน้าลานจากหน้า Monitor 3D — ภาพรวมวันนี้, สถานะจุด/สิ่งอำนวยความสะดวก,
 * งานแม่บ้าน/งานซ่อม และบันทึกกิจกรรม
 *
 * การจอง/เช็คอิน/เอาท์/รับเงิน ยังอยู่ที่ ReservationsService ตัวเดิม (ตัวนี้ไม่ทำซ้ำ)
 */
@Injectable()
export class CampOpsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ข้อมูลทั้งหมดที่แผงจัดการลานต้องใช้ในคำขอเดียว
   * — การเข้าพักที่ยัง active ช่วงวันนี้/พรุ่งนี้ (+แขกค้างเกินวันออก) พร้อมยอดคงค้าง
   * — งานที่ยังไม่ปิด, กิจกรรมล่าสุด, ยอดรับชำระวันนี้ (เวลาไทย)
   */
  async board(campgroundId: string, tenantId: string) {
    const campground = await this.prisma.campground.findFirst({
      where: { id: campgroundId, tenantId },
      select: { id: true, name: true, checkInTime: true, checkOutTime: true, warehouseId: true },
    });
    if (!campground) throw new NotFoundException('ไม่พบลานนี้');

    const today = toBangkokDate(new Date());
    const todayDate = businessDateOf(today);
    const dayAfter = businessDateOf(shiftDate(today, 2));
    const { start: todayStart } = bangkokDayRange(today);

    const [rows, tasks, events, paidRows] = await Promise.all([
      this.prisma.campReservation.findMany({
        where: {
          tenantId,
          campgroundId,
          status: { in: ACTIVE_STAY },
          OR: [{ status: 'checked_in' }, { checkIn: { lt: dayAfter }, checkOut: { gt: todayDate } }],
        },
        orderBy: { checkIn: 'asc' },
        take: 500,
        select: {
          id: true,
          pitchId: true,
          reservationNo: true,
          guestFirstName: true,
          guestLastName: true,
          guestPhone: true,
          numGuests: true,
          numVehicles: true,
          vehiclePlate: true,
          idVerifiedAt: true,
          checkIn: true,
          checkOut: true,
          status: true,
          totalPrice: true,
          amountPaid: true,
          paymentStatus: true,
          source: true,
          notes: true,
          extraCharges: true,
          addonItems: { select: { addonId: true, name: true, qty: true, priceSnapshot: true } },
        },
      }),
      this.prisma.campOpsTask.findMany({
        where: { tenantId, campgroundId, status: { in: OPEN_TASK } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.campOpsEvent.findMany({
        where: { tenantId, campgroundId },
        orderBy: { createdAt: 'desc' },
        take: MAX_EVENTS,
      }),
      this.prisma.campReservation.findMany({
        where: { tenantId, campgroundId, updatedAt: { gte: todayStart } },
        select: { payments: true },
      }),
    ]);

    const names = await this.userNames(
      tenantId,
      events.map((e) => e.actorId),
    );
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const revenueToday = paidRows.reduce((sum, r) => {
      if (!Array.isArray(r.payments)) return sum;
      return (
        sum +
        (r.payments as { at?: string; amount?: number }[]).reduce(
          (s, p) => (p?.at && new Date(p.at) >= todayStart ? s + Number(p.amount ?? 0) : s),
          0,
        )
      );
    }, 0);

    return {
      success: true,
      data: {
        campground,
        today,
        revenueToday: Math.round(revenueToday * 100) / 100,
        stays: rows.map((r) => {
          const total = Number(r.totalPrice);
          const paid = Number(r.amountPaid ?? 0);
          return {
            id: r.id,
            pitchId: r.pitchId,
            reservationNo: r.reservationNo,
            guestName: guestName(r),
            guestPhone: r.guestPhone,
            numGuests: r.numGuests,
            numVehicles: r.numVehicles,
            vehiclePlate: r.vehiclePlate,
            idVerified: Boolean(r.idVerifiedAt),
            checkIn: dayKey(r.checkIn),
            checkOut: dayKey(r.checkOut),
            status: r.status,
            source: r.source,
            notes: r.notes,
            totalPrice: total,
            amountPaid: paid,
            balance: Math.round((total - paid) * 100) / 100,
            paymentStatus: r.paymentStatus,
            addons: r.addonItems.map((a) => ({ ...a, priceSnapshot: Number(a.priceSnapshot) })),
            charges: parseExtraCharges(r.extraCharges),
          };
        }),
        tasks: tasks.map((t) => ({ ...t, cost: t.cost === null ? null : Number(t.cost) })),
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          message: e.message,
          pitchId: e.pitchId,
          reservationId: e.reservationId,
          actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  /**
   * ตั้งสถานะจุดจากหน้างาน (แม่บ้านเสร็จ / ปิดจุด / เปิดจุด)
   * จุดที่มีแขกเช็คอินอยู่เปลี่ยนไม่ได้ — "มีแขก" มาจากการเช็คอินเท่านั้น
   */
  async setPitchStatus(pitchId: string, dto: SetPitchStatusDto, tenantId: string, actorId?: string) {
    const pitch = await this.prisma.campPitch.findFirst({
      where: { id: pitchId, tenantId },
      select: { id: true, code: true, status: true, campgroundId: true },
    });
    if (!pitch) throw new NotFoundException('ไม่พบจุดนี้');
    const guest = await this.prisma.campReservation.findFirst({
      where: { pitchId, status: 'checked_in' },
      select: { id: true },
    });
    if (guest) throw new ConflictException(`จุด ${pitch.code} มีแขกพักอยู่ — เปลี่ยนสถานะไม่ได้`);

    const data = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campPitch.update({ where: { id: pitchId }, data: { status: dto.status } });
      // จุดพร้อมขายแล้ว = งานทำความสะอาดที่ค้างของจุดนี้จบ
      if (dto.status === 'available') {
        await tx.campOpsTask.updateMany({
          where: { tenantId, pitchId, type: 'cleaning', status: { in: OPEN_TASK } },
          data: { status: 'done', completedAt: new Date(), completedBy: actorId ?? null },
        });
      }
      await logOpsEvent(tx, {
        tenantId,
        campgroundId: pitch.campgroundId,
        type: 'pitch_status',
        pitchId,
        actorId,
        message: `${pitch.code} → ${PITCH_STATUS_TH[dto.status]}${dto.reason ? ` · ${dto.reason}` : ''}`,
      });
      return updated;
    });
    return { success: true, data };
  }

  async setFacilityStatus(facilityId: string, dto: SetFacilityStatusDto, tenantId: string, actorId?: string) {
    const facility = await this.prisma.campFacility.findFirst({
      where: { id: facilityId, tenantId },
      select: { id: true, name: true, campgroundId: true },
    });
    if (!facility) throw new NotFoundException('ไม่พบสิ่งอำนวยความสะดวกนี้');
    const data = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campFacility.update({ where: { id: facilityId }, data: { status: dto.status } });
      if (dto.status === 'open') {
        await tx.campOpsTask.updateMany({
          where: { tenantId, facilityId, type: 'maintenance', status: { in: OPEN_TASK } },
          data: { status: 'done', completedAt: new Date(), completedBy: actorId ?? null },
        });
      }
      await logOpsEvent(tx, {
        tenantId,
        campgroundId: facility.campgroundId,
        type: 'facility_status',
        actorId,
        message: `${facility.name} → ${FACILITY_STATUS_TH[dto.status]}${dto.note ? ` · ${dto.note}` : ''}`,
      });
      return updated;
    });
    return { success: true, data };
  }

  /**
   * เปิดงานแม่บ้าน/งานซ่อม
   * — ทำความสะอาด: จุดว่างจะถูกตั้งเป็น "รอทำความสะอาด"
   * — ซ่อม + blocksPitch: จุดถูกปิดซ่อม (จุดที่มีแขกไม่ปิด แค่เปิดงานให้ช่าง)
   * — ซ่อมสิ่งอำนวยความสะดวก: สถานะเป็น "ซ่อม"
   */
  async createTask(dto: CreateOpsTaskDto, tenantId: string, actorId?: string) {
    if (!dto.pitchId && !dto.facilityId) throw new BadRequestException('ต้องระบุจุดหรือสิ่งอำนวยความสะดวก');
    if (dto.pitchId && dto.facilityId) throw new BadRequestException('ระบุได้อย่างใดอย่างหนึ่ง');
    if (dto.type === 'cleaning' && !dto.pitchId) throw new BadRequestException('งานทำความสะอาดต้องผูกกับจุด');

    const camp = await this.prisma.campground.findFirst({ where: { id: dto.campgroundId, tenantId }, select: { id: true } });
    if (!camp) throw new NotFoundException('ไม่พบลานนี้');

    const pitch = dto.pitchId
      ? await this.prisma.campPitch.findFirst({
          where: { id: dto.pitchId, tenantId, campgroundId: dto.campgroundId },
          select: { id: true, code: true, status: true },
        })
      : null;
    const facility = dto.facilityId
      ? await this.prisma.campFacility.findFirst({
          where: { id: dto.facilityId, tenantId, campgroundId: dto.campgroundId },
          select: { id: true, name: true },
        })
      : null;
    if (dto.pitchId && !pitch) throw new NotFoundException('ไม่พบจุดนี้');
    if (dto.facilityId && !facility) throw new NotFoundException('ไม่พบสิ่งอำนวยความสะดวกนี้');

    const guest = pitch
      ? await this.prisma.campReservation.findFirst({
          where: { pitchId: pitch.id, status: 'checked_in' },
          select: { id: true },
        })
      : null;
    if (dto.type === 'cleaning' && guest) {
      throw new ConflictException(`จุด ${pitch!.code} มีแขกพักอยู่ — เปิดงานทำความสะอาดหลังเช็คเอาท์`);
    }
    if (dto.type === 'cleaning') {
      const open = await this.prisma.campOpsTask.findFirst({
        where: { tenantId, pitchId: pitch!.id, type: 'cleaning', status: { in: OPEN_TASK } },
      });
      if (open) {
        // มีงานค้างอยู่แล้ว — ถือเป็นการมอบหมายใหม่ ไม่สร้างงานซ้อน
        return this.updateTask(open.id, { assigneeName: dto.assigneeName, notes: dto.notes }, tenantId, actorId);
      }
    }

    const title =
      dto.title?.trim() || (dto.type === 'cleaning' ? 'ทำความสะอาดจุด' : 'แจ้งซ่อม');
    const assignee = dto.assigneeName?.trim() || null;
    const blocks = dto.type === 'maintenance' && Boolean(pitch) && Boolean(dto.blocksPitch) && !guest;

    const data = await this.prisma.$transaction(async (tx) => {
      const task = await tx.campOpsTask.create({
        data: {
          tenantId,
          campgroundId: dto.campgroundId,
          pitchId: pitch?.id ?? null,
          facilityId: facility?.id ?? null,
          type: dto.type,
          title,
          priority: dto.priority ?? 'normal',
          assigneeName: assignee,
          status: assignee ? 'in_progress' : 'open',
          startedAt: assignee ? new Date() : null,
          blocksPitch: blocks,
          notes: dto.notes?.trim() || null,
          createdBy: actorId ?? null,
        },
      });
      if (pitch && dto.type === 'cleaning' && pitch.status === 'available') {
        await tx.campPitch.update({ where: { id: pitch.id }, data: { status: 'cleaning' } });
      }
      if (blocks) {
        await tx.campPitch.update({ where: { id: pitch!.id }, data: { status: 'maintenance' } });
      }
      if (facility && dto.type === 'maintenance') {
        await tx.campFacility.update({ where: { id: facility.id }, data: { status: 'maintenance' } });
      }
      const where = pitch ? pitch.code : facility!.name;
      await logOpsEvent(tx, {
        tenantId,
        campgroundId: dto.campgroundId,
        type: dto.type,
        pitchId: pitch?.id ?? null,
        actorId,
        message:
          dto.type === 'cleaning'
            ? `เปิดงานทำความสะอาด ${where}${assignee ? ` · ${assignee}` : ''}`
            : `แจ้งซ่อม ${where} · ${title}${assignee ? ` · ${assignee}` : ''}${blocks ? ' · ปิดจุดระหว่างซ่อม' : ''}`,
      });
      return task;
    });
    return { success: true, data };
  }

  /**
   * อัปเดต/ปิดงาน — ปิดงานแล้วคืนสถานะจุด/สิ่งอำนวยความสะดวกให้อัตโนมัติ
   *   ทำความสะอาดเสร็จ → จุดพร้อมขาย (ถ้าไม่มีแขก)
   *   ซ่อมจุดเสร็จ → dto.after (ค่าเริ่มต้นส่งแม่บ้าน) · ซ่อมสิ่งอำนวยความสะดวกเสร็จ → เปิด
   */
  async updateTask(id: string, dto: UpdateOpsTaskDto, tenantId: string, actorId?: string) {
    const task = await this.prisma.campOpsTask.findFirst({ where: { id, tenantId } });
    if (!task) throw new NotFoundException('ไม่พบงานนี้');
    if (task.status === 'done' || task.status === 'cancelled') {
      throw new BadRequestException('งานนี้ปิดไปแล้ว');
    }
    const [pitch, facility] = await Promise.all([
      task.pitchId
        ? this.prisma.campPitch.findFirst({ where: { id: task.pitchId }, select: { id: true, code: true, status: true } })
        : null,
      task.facilityId
        ? this.prisma.campFacility.findFirst({ where: { id: task.facilityId }, select: { id: true, name: true } })
        : null,
    ]);
    const closing = dto.status === 'done' || dto.status === 'cancelled';
    const assignee = dto.assigneeName !== undefined ? dto.assigneeName.trim() || null : task.assigneeName;
    const status =
      dto.status ?? (assignee && task.status === 'open' ? 'in_progress' : (task.status as UpdateOpsTaskDto['status']));

    const data = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campOpsTask.update({
        where: { id },
        data: {
          status,
          assigneeName: assignee,
          ...(dto.cost !== undefined ? { cost: new Prisma.Decimal(dto.cost) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(status === 'in_progress' && !task.startedAt ? { startedAt: new Date() } : {}),
          ...(closing ? { completedAt: new Date(), completedBy: actorId ?? null } : {}),
        },
      });

      if (closing && pitch) {
        const guest = await tx.campReservation.findFirst({
          where: { pitchId: pitch.id, status: 'checked_in' },
          select: { id: true },
        });
        if (!guest) {
          const next =
            task.type === 'cleaning'
              ? dto.status === 'done'
                ? 'available'
                : null
              : pitch.status === 'maintenance'
                ? dto.status === 'done'
                  ? (dto.after ?? 'cleaning')
                  : 'available'
                : null;
          if (next) await tx.campPitch.update({ where: { id: pitch.id }, data: { status: next } });
          if (next === 'cleaning') {
            await tx.campOpsTask.create({
              data: {
                tenantId,
                campgroundId: task.campgroundId,
                pitchId: pitch.id,
                type: 'cleaning',
                title: 'เก็บงานหลังซ่อม',
                createdBy: actorId ?? null,
              },
            });
          }
        }
      }
      if (closing && facility && task.type === 'maintenance' && dto.status === 'done') {
        const otherOpen = await tx.campOpsTask.count({
          where: { tenantId, facilityId: facility.id, id: { not: id }, status: { in: OPEN_TASK } },
        });
        if (!otherOpen) await tx.campFacility.update({ where: { id: facility.id }, data: { status: 'open' } });
      }

      const where = pitch?.code ?? facility?.name ?? '';
      const verb =
        dto.status === 'done'
          ? task.type === 'cleaning'
            ? `ทำความสะอาด ${where} เสร็จ`
            : `ปิดงานซ่อม ${where} · ${task.title}`
          : dto.status === 'cancelled'
            ? `ยกเลิกงาน ${where} · ${task.title}`
            : assignee !== task.assigneeName
              ? `มอบหมาย ${assignee ?? '—'} · ${task.type === 'cleaning' ? 'ทำความสะอาด' : task.title} ${where}`
              : `อัปเดตงาน ${where} · ${task.title}`;
      await logOpsEvent(tx, {
        tenantId,
        campgroundId: task.campgroundId,
        type: task.type === 'cleaning' ? 'cleaning' : 'maintenance',
        pitchId: pitch?.id ?? null,
        actorId,
        message: `${verb}${dto.status === 'done' && dto.cost ? ` · ค่าใช้จ่าย ${dto.cost.toLocaleString('th-TH')} บาท` : ''}`,
      });
      return updated;
    });
    return { success: true, data: { ...data, cost: data.cost === null ? null : Number(data.cost) } };
  }

  private async userNames(tenantId: string, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique }, tenantId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]),
    );
  }
}
