import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { REQUIRE_ADDON_KEY } from '../../common/decorators/require-addon.decorator';
import { RestaurantController } from '../restaurant/restaurant.controller';

/**
 * launch token ของ Terminal ยกระดับ role (accounting_manager, hr_manager …)
 * ต้องกันด้วย role ฝั่ง API — ปุ่ม SSO ที่ซ่อนบนหน้าเว็บไม่ใช่ด่าน
 * (เคยพบ: แม่บ้านยิง POST /auth/accounting-launch ตรง ๆ แล้วได้ session ผู้จัดการบัญชี)
 */
const ELEVATING = [
  'purchasingLaunch',
  'warehouseLaunch',
  'accountingLaunch',
  'hrLaunch',
  'hotelTerminalLaunch',
] as const;

const guard = new RolesGuard(new Reflector());
const handlerOf = (name: string) =>
  (AuthController.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[name];

function contextFor(handler: (...a: unknown[]) => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AuthController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

function allowed(handler: (...a: unknown[]) => unknown, role: string): boolean {
  try {
    return guard.canActivate(contextFor(handler, role));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('AuthController — ใครออก launch token ของ Terminal ได้', () => {
  it.each(ELEVATING)('%s ติดทั้ง JwtAuthGuard และ RolesGuard', (name) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handlerOf(name)) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it.each(ELEVATING)('%s: เจ้าของ/ผู้จัดการผ่าน', (name) => {
    for (const role of ['platform_admin', 'tenant_admin', 'admin', 'manager']) {
      expect(allowed(handlerOf(name), role)).toBe(true);
    }
  });

  it.each(ELEVATING)('%s: พนักงานทั่วไปและ role เฉพาะทางโดนกัน', (name) => {
    for (const role of [
      'housekeeper',
      'maintenance',
      'receptionist',
      'waiter',
      'cashier',
      'staff',
      'hr',
      'procurement_manager',
      'accountant',
      'restaurant_manager',
      'front_desk',
      'user',
    ]) {
      expect(allowed(handlerOf(name), role)).toBe(false);
    }
  });
});

describe('AuthController — pos-launch ต้องมี add-on RESTAURANT_MODULE (BUG-13)', () => {
  it('ติด JwtAuthGuard + AddonGuard และ @RequireAddon(RESTAURANT_MODULE) เหมือน /restaurants', () => {
    const handler = handlerOf('posLaunch');
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, AddonGuard]));
    expect(Reflect.getMetadata(REQUIRE_ADDON_KEY, handler)).toBe('RESTAURANT_MODULE');
    expect(Reflect.getMetadata(REQUIRE_ADDON_KEY, RestaurantController)).toBe('RESTAURANT_MODULE');
  });
});
