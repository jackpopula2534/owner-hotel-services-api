/**
 * BUG-11 (Test Report รอบ 6): KDS ใช้ /auth/pos-launch ร่วมกับ POS แต่ API เช็คความพร้อม
 * ของ 'pos' (ต้องมีเมนู) ตายตัว → ร้านใหม่ที่ยังไม่มีเมนู การ์ด Kitchen Display ขึ้น
 * "พร้อมใช้งาน" แต่กดแล้วได้ 409 NO_MENU
 *
 * ตอนนี้ launch บอก target ('pos' | 'kitchen') แล้วเช็คความพร้อมตามระบบนั้น
 */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { PosLaunchDto } from './dto/pos-launch.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { OnboardingService } from '../../onboarding/onboarding.service';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

describe('AuthService — POS / KDS launch readiness (BUG-11)', () => {
  let service: AuthService;
  const caller = {
    userId: 'user-1',
    email: 'o@x.test',
    role: 'tenant_admin',
    tenantId: 'tenant-1',
  };

  const counts = { restaurant: 1, menuItem: 0, campground: 1, campPitch: 1, property: 1, room: 0 };
  const countOf = (k: keyof typeof counts) => ({ count: jest.fn(async () => counts[k]) });
  const mockPrisma = {
    restaurant: { ...countOf('restaurant'), findFirst: jest.fn() },
    menuItem: countOf('menuItem'),
    campground: countOf('campground'),
    campPitch: countOf('campPitch'),
    property: countOf('property'),
    room: countOf('room'),
  };
  const mockJwt = {
    sign: jest.fn().mockReturnValue('launch-jwt'),
    verify: jest.fn(),
    decode: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: { get: jest.fn(() => null) } },
        { provide: EmailEventsService, useValue: { emit: jest.fn() } },
        { provide: OnboardingService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    counts.restaurant = 1;
    counts.menuItem = 0;
    mockPrisma.restaurant.findFirst.mockResolvedValue({ id: 'rest-1', name: 'QA ร้านทดสอบ' });
    mockJwt.sign.mockClear();
    mockJwt.sign.mockReturnValue('launch-jwt');
  });

  it('KDS เปิดได้แม้ร้านยังไม่มีเมนู และได้ URL ของจอครัว', async () => {
    const res = await service.generatePosLaunchToken(
      { restaurantId: 'rest-1', target: 'kitchen' },
      caller,
    );
    expect(res.data.token).toBe('launch-jwt');
    expect(res.data.posUrl).toBe('/pos/kitchen?token=launch-jwt&restaurantId=rest-1');
  });

  it('POS ยังต้องมีเมนู → 409 NO_MENU', async () => {
    await expect(
      service.generatePosLaunchToken({ restaurantId: 'rest-1', target: 'pos' }, caller),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        subSystem: 'pos',
        missing: [expect.objectContaining({ code: 'NO_MENU' })],
      }),
    });
    expect(mockJwt.sign).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง target = POS (client เก่ายังได้พฤติกรรมเดิม)', async () => {
    await expect(
      service.generatePosLaunchToken({ restaurantId: 'rest-1' }, caller),
    ).rejects.toThrow(ConflictException);
    counts.menuItem = 3;
    const res = await service.generatePosLaunchToken(
      { restaurantId: 'rest-1', tableId: 't9' },
      caller,
    );
    expect(res.data.posUrl).toBe('/pos?token=launch-jwt&restaurantId=rest-1&tableId=t9');
  });

  it('KDS ยังต้องมีร้านของ tenant ตัวเอง', async () => {
    mockPrisma.restaurant.findFirst.mockResolvedValue(null);
    await expect(
      service.generatePosLaunchToken({ restaurantId: 'other', target: 'kitchen' }, caller),
    ).rejects.toThrow(BadRequestException);
  });

  it('DTO รับเฉพาะ pos | kitchen', async () => {
    const bad = await validate(
      plainToInstance(PosLaunchDto, { restaurantId: 'r', target: 'admin' }),
    );
    expect(bad.map((e) => e.property)).toEqual(['target']);
    const ok = await validate(
      plainToInstance(PosLaunchDto, { restaurantId: 'r', target: 'kitchen' }),
    );
    expect(ok).toHaveLength(0);
  });
});
