import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokDayRange, shiftDate, toBangkokDate } from '@/common/utils/bangkok-day.util';
import { hotelMap3dSummary, sanitizeHotelMap3dConfig } from './hotel-map3d-config';
import type { HotelMap3dConfig } from './hotel-map3d.types';

export const MAX_HOTEL_MAP3D_VERSIONS = 30;
const ACTIVE_STAY = ['pending', 'confirmed', 'checked_in'];
const OPEN_HK = ['pending', 'in_progress'];
const CLOSED_MAINT = ['completed', 'cancelled'];

/**
 * ฉาก 3D ของโรงแรม + ข้อมูลหน้า Monitor
 *
 * ทุกคำสั่งรับ propertyId + tenantId และตรวจว่า property เป็นของ tenant นี้ก่อนเสมอ
 * (ไม่ให้เดา id ของโรงแรมอื่นแล้วอ่านฉาก/การจองได้)
 */
@Injectable()
export class HotelMap3dService {
  constructor(private readonly prisma: PrismaService) {}

  private async property(propertyId: string, tenantId: string) {
    const p = await this.prisma.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null },
      select: { id: true, name: true, floors: true, map3dConfig: true, map3dUpdatedAt: true, standardCheckInTime: true, standardCheckOutTime: true },
    });
    if (!p) throw new NotFoundException('ไม่พบโรงแรมนี้');
    return p;
  }

  async get(propertyId: string, tenantId: string) {
    const p = await this.property(propertyId, tenantId);
    return {
      success: true,
      data: {
        propertyId,
        config: (p.map3dConfig as unknown as HotelMap3dConfig | null) ?? null,
        updatedAt: p.map3dUpdatedAt,
      },
    };
  }

  /** เผยแพร่ฉาก — ตรวจห้องกับฐานข้อมูล เก็บเวอร์ชัน และตัดเวอร์ชันเก่าเกิน 30 */
  async save(propertyId: string, tenantId: string, raw: unknown, userId?: string) {
    await this.property(propertyId, tenantId);
    const rooms = await this.prisma.room.findMany({ where: { propertyId }, select: { id: true } });
    const config = sanitizeHotelMap3dConfig(raw, new Set(rooms.map((r) => r.id)));
    const json = config as unknown as Prisma.InputJsonValue;

    const data = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.property.update({
        where: { id: propertyId },
        data: { map3dConfig: json, map3dUpdatedAt: new Date() },
        select: { id: true, map3dConfig: true, map3dUpdatedAt: true },
      });
      await tx.hotelMap3dVersion.create({
        data: {
          tenantId,
          propertyId,
          config: json,
          summary: hotelMap3dSummary(config) as unknown as Prisma.InputJsonValue,
          createdBy: userId ?? null,
        },
      });
      const old = await tx.hotelMap3dVersion.findMany({
        where: { tenantId, propertyId },
        orderBy: { createdAt: 'desc' },
        skip: MAX_HOTEL_MAP3D_VERSIONS,
        select: { id: true },
      });
      if (old.length) await tx.hotelMap3dVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } });
      return updated;
    });
    return { success: true, data: { propertyId, config: data.map3dConfig, updatedAt: data.map3dUpdatedAt } };
  }

  async listVersions(propertyId: string, tenantId: string) {
    await this.property(propertyId, tenantId);
    const rows = await this.prisma.hotelMap3dVersion.findMany({
      where: { tenantId, propertyId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HOTEL_MAP3D_VERSIONS,
      select: { id: true, summary: true, createdBy: true, createdAt: true },
    });
    const ids = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => Boolean(v)))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email]));
    return {
      success: true,
      data: rows.map((r, i) => ({
        id: r.id,
        createdAt: r.createdAt,
        createdBy: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        summary: r.summary,
        current: i === 0,
      })),
    };
  }

  async getVersion(propertyId: string, versionId: string, tenantId: string) {
    await this.property(propertyId, tenantId);
    const v = await this.prisma.hotelMap3dVersion.findFirst({ where: { id: versionId, tenantId, propertyId } });
    if (!v) throw new NotFoundException('ไม่พบเวอร์ชันนี้');
    return { success: true, data: { id: v.id, createdAt: v.createdAt, config: v.config } };
  }

  /**
   * ข้อมูลทั้งหมดที่หน้า Monitor ต้องใช้ในคำขอเดียว
   * — ห้อง + การเข้าพักที่ active วันนี้/พรุ่งนี้ (+แขกค้างเกินวันออก) พร้อมยอดค้าง
   * — งานแม่บ้านที่ยังไม่จบ + งานที่ทำเสร็จวันนี้แต่ยังไม่ตรวจ (สถานะ "รอตรวจ")
   * — งานซ่อมที่ยังไม่ปิด
   */
  async board(propertyId: string, tenantId: string) {
    const p = await this.property(propertyId, tenantId);
    const today = toBangkokDate(new Date());
    const { start: todayStart } = bangkokDayRange(today);
    const { start: afterTomorrow } = bangkokDayRange(shiftDate(today, 2));

    const [rooms, bookings, hk, maint] = await Promise.all([
      this.prisma.room.findMany({
        where: { propertyId },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        select: { id: true, number: true, type: true, floor: true, status: true, price: true, maxOccupancy: true },
      }),
      this.prisma.booking.findMany({
        where: {
          propertyId,
          ...(tenantId ? { tenantId } : {}),
          status: { in: ACTIVE_STAY },
          OR: [{ status: 'checked_in' }, { checkIn: { lt: afterTomorrow }, checkOut: { gt: todayStart } }],
        },
        orderBy: { checkIn: 'asc' },
        take: 1000,
        select: {
          id: true,
          bookingNo: true,
          roomId: true,
          guestFirstName: true,
          guestLastName: true,
          guestPhone: true,
          adults: true,
          children: true,
          checkIn: true,
          checkOut: true,
          status: true,
          totalPrice: true,
          grandTotal: true,
          amountPaid: true,
          paymentStatus: true,
          source: true,
          notes: true,
          approvedEarlyCheckIn: true,
          approvedLateCheckOut: true,
          idVerifiedAt: true,
          keyCards: true,
          depositAmount: true,
          depositReturnedAt: true,
          awaitingRoomSince: true,
          guest: { select: { isVip: true, vipLevel: true } },
          guestFolios: { where: { status: 'OPEN' }, select: { balance: true }, take: 1 },
        },
      }),
      this.prisma.housekeepingTask.findMany({
        where: {
          tenantId,
          room: { propertyId },
          OR: [{ status: { in: OPEN_HK } }, { status: 'completed', inspectedAt: null, updatedAt: { gte: todayStart } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: { id: true, roomId: true, type: true, status: true, priority: true, assignedToId: true, assignedToName: true, notes: true, createdAt: true },
      }),
      this.prisma.maintenanceTask.findMany({
        where: { tenantId, propertyId, status: { notIn: CLOSED_MAINT } },
        orderBy: { createdAt: 'asc' },
        take: 300,
        select: {
          id: true,
          roomId: true,
          title: true,
          category: true,
          priority: true,
          status: true,
          assignedTo: { select: { firstName: true, lastName: true } },
          createdAt: true,
        },
      }),
    ]);

    const dayKey = (d: Date) => toBangkokDate(d);
    return {
      success: true,
      data: {
        property: { id: p.id, name: p.name, floors: p.floors, checkInTime: p.standardCheckInTime, checkOutTime: p.standardCheckOutTime },
        today,
        rooms: rooms.map((r) => ({ ...r, price: Number(r.price) })),
        stays: bookings.map((b) => {
          const total = Number(b.grandTotal ?? b.totalPrice);
          const paid = Number(b.amountPaid ?? 0);
          const folio = b.guestFolios[0];
          return {
            id: b.id,
            bookingNo: b.bookingNo,
            roomId: b.roomId,
            guestName: [b.guestFirstName, b.guestLastName].filter(Boolean).join(' '),
            guestPhone: b.guestPhone,
            guests: (b.adults ?? 1) + (b.children ?? 0),
            checkIn: dayKey(b.checkIn),
            checkOut: dayKey(b.checkOut),
            status: b.status,
            source: b.source,
            notes: b.notes,
            vip: Boolean(b.guest?.isVip),
            total,
            paid,
            // folio ที่เปิดอยู่รวมค่าบริการระหว่างพักแล้ว — เชื่อ folio ก่อน
            balance: Math.round((folio ? Number(folio.balance) : total - paid) * 100) / 100,
            earlyCheckIn: Boolean(b.approvedEarlyCheckIn),
            lateCheckOut: Boolean(b.approvedLateCheckOut),
            idVerified: Boolean(b.idVerifiedAt),
            keyCards: b.keyCards,
            /** เงินประกันที่ยังถืออยู่ (คืนแล้ว = 0) */
            deposit: b.depositAmount && !b.depositReturnedAt ? Number(b.depositAmount) : 0,
            awaitingRoom: Boolean(b.awaitingRoomSince),
          };
        }),
        housekeeping: hk,
        maintenance: maint.map((m) => ({
          id: m.id,
          roomId: m.roomId,
          title: m.title,
          category: m.category,
          priority: m.priority,
          status: m.status,
          assigneeName: m.assignedTo ? `${m.assignedTo.firstName} ${m.assignedTo.lastName}`.trim() : null,
          createdAt: m.createdAt,
        })),
      },
    };
  }
}
