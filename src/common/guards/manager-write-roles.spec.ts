// H1.3 (audit 2026-11-09) — inside the Hotel Terminal, front desk / housekeeping
// could change payment accounts (where guests' money goes) and connect/disconnect
// LINE / Facebook. Writes are now managers-only; day-to-day reads/replies stay open.
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PaymentAccountsController } from '../../modules/payment-accounts/payment-accounts.controller';
import { MessagingController } from '../../modules/messaging/messaging.controller';
import { MANAGER_WRITE_ROLES } from '../constants/manager-write-roles';

type Ctor = { prototype: Record<string, unknown> };
const routes = (c: Ctor) =>
  Object.getOwnPropertyNames(c.prototype)
    .filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, c.prototype[n] as object) !== undefined)
    .map((n) => {
      const fn = c.prototype[n] as object;
      return {
        name: n,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)],
        path: String(Reflect.getMetadata(PATH_METADATA, fn)),
        roles: (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) ?? null,
      };
    });

const decide = (role: string, roles: readonly string[]) => {
  const guard = new RolesGuard({
    getAllAndOverride: (key: string) => (key === ROLES_KEY ? roles : undefined),
  } as unknown as Reflector);
  const ctx = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) };
  try {
    return guard.canActivate(ctx as never) === true;
  } catch {
    return false;
  }
};

describe('H1.3 manager-only writes', () => {
  it('every payment-accounts write carries MANAGER_WRITE_ROLES; reads stay open', () => {
    const r = routes(PaymentAccountsController as unknown as Ctor);
    const writes = r.filter((x) => x.method !== 'GET');
    expect(writes.length).toBe(5);
    for (const w of writes) expect(w.roles).toEqual([...MANAGER_WRITE_ROLES]);
    for (const g of r.filter((x) => x.method === 'GET')) expect(g.roles).toBeNull();
  });

  it('messaging integrations + auto-reply template writes are managers-only; replying is not', () => {
    const r = routes(MessagingController as unknown as Ctor);
    const locked = r.filter((x) => x.method !== 'GET' && /^(integrations|auto-reply-templates)/.test(x.path));
    expect(locked.length).toBe(7);
    for (const w of locked) expect(w.roles).toEqual([...MANAGER_WRITE_ROLES]);
    expect(r.find((x) => x.path === 'reply')?.roles).toBeNull();
  });

  it.each([
    ['hotel_manager', true],
    ['camp_manager', true],
    ['tenant_admin', true],
    ['manager', true],
    ['front_desk', false],
    ['housekeeper', false],
    ['maintenance', false],
    ['waiter', false],
    ['receptionist', false],
  ])('RolesGuard: %s → %s', (role, ok) => {
    expect(decide(role as string, MANAGER_WRITE_ROLES)).toBe(ok);
  });
});
