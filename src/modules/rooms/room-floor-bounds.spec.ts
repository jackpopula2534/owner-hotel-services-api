import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { RoomsService } from './rooms.service';

/**
 * "ชั้น" ของห้องต้องอยู่ในกรอบจำนวนชั้นของที่พัก
 *
 * ก่อนหน้านี้ floor เป็นเลขอิสระ ไม่มีอะไรผูกกับที่พักเลย — ปุ่ม autofill ตอน dev
 * คิดชั้นจาก Math.ceil(เลขห้อง / 10) ห้อง 101 จึงถูกบันทึกเป็นชั้น 11 ได้จริง
 * และหน้าจอที่ไล่รายชื่อชั้นจากห้อง (แผนผังห้อง / room-heatmap) ก็งอกชั้นผีตามไปด้วย
 *
 * อีกครึ่งของบั๊กคือปล่อยชั้นว่างได้ ทั้งที่ฟอร์มติดดอกจันว่าบังคับ — ห้องที่ไม่มีชั้น
 * จะหลุดจากตัวกรองชั้นทุกหน้าจอแบบเงียบ ๆ
 */
describe('RoomsService — floor must fit the property', () => {
  let service: RoomsService;

  const prismaMock = {
    property: { findFirst: jest.fn() },
    room: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    subscriptions: { findFirst: jest.fn() },
  };

  const auditLogMock = {
    logRoomCreate: jest.fn().mockResolvedValue(undefined),
    logRoomUpdate: jest.fn().mockResolvedValue(undefined),
  };

  const tenantId = 'tenant-1';
  const propertyId = 'property-1';
  const baseRoom = { number: '101', type: 'standard', price: 1500, propertyId };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuditLogService, useValue: auditLogMock },
      ],
    }).compile();

    service = module.get(RoomsService);
    jest.clearAllMocks();

    // ที่พักตัวอย่างตั้งไว้ 3 ชั้น
    prismaMock.property.findFirst.mockResolvedValue({ id: propertyId, tenantId, floors: 3 });
    prismaMock.subscriptions.findFirst.mockResolvedValue(null);
    prismaMock.room.findFirst.mockResolvedValue(null); // ไม่มีเลขห้องซ้ำ
    prismaMock.room.create.mockImplementation(async ({ data }: any) => ({ id: 'room-1', ...data }));
  });

  it('rejects a room on a floor the property does not have', async () => {
    await expect(
      service.create({ ...baseRoom, floor: 11 } as any, tenantId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.room.create).not.toHaveBeenCalled();
  });

  it('says how many floors the property actually has', async () => {
    await expect(service.create({ ...baseRoom, floor: 11 } as any, tenantId)).rejects.toThrow(
      /3 ชั้น/,
    );
  });

  it('accepts the top floor of the property', async () => {
    await service.create({ ...baseRoom, floor: 3 } as any, tenantId);

    expect(prismaMock.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ floor: 3 }) }),
    );
  });

  it('never stores a room without a floor — no floor means floor 1', async () => {
    await service.create({ ...baseRoom } as any, tenantId);

    expect(prismaMock.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ floor: 1 }) }),
    );
  });

  it('checks the same bound when moving an existing room', async () => {
    prismaMock.room.findFirst.mockResolvedValue({
      id: 'room-1',
      number: '101',
      propertyId,
      tenantId,
      property: { id: propertyId, floors: 3 },
    });

    await expect(service.update('room-1', { floor: 7 } as any, tenantId)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaMock.room.update).not.toHaveBeenCalled();
  });
});
