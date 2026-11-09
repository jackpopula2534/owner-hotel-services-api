// audit 2026-11-09 — these platform-admin endpoints only had JwtAuthGuard, so any
// logged-in tenant user (even a hotel-terminal or HR token) could mint
// impersonation tokens, create 100% coupons, broadcast announcements to every
// tenant, read SaaS revenue, delete queue jobs, run dunning, etc.
// This spec pins PlatformAdminGuard on every one of them.
import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PlatformAdminGuard } from './platform-admin.guard';
import { AdminAnalyticsController } from '../../admin-analytics/admin-analytics.controller';
import { DatabaseOptimizationController } from '../../database-optimization/database-optimization.controller';
import { QueueMonitorController } from '../../queue-monitor/queue-monitor.controller';
import { DunningController } from '../../dunning/dunning.controller';
import { ImpersonationController } from '../../impersonation/impersonation.controller';
import { CouponsController } from '../../coupons/coupons.controller';
import { AnnouncementsController } from '../../announcements/announcements.controller';
import { DataExportController } from '../../data-export/data-export.controller';

type Ctor = { prototype: Record<string, unknown>; name: string };

const guardsOf = (target: object): unknown[] => Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

function routes(ctrl: Ctor): { name: string; path: string; guarded: boolean }[] {
  const classGuarded = guardsOf(ctrl).includes(PlatformAdminGuard);
  return Object.getOwnPropertyNames(ctrl.prototype)
    .filter((n) => n !== 'constructor')
    .map((n) => {
      const fn = ctrl.prototype[n] as object;
      const path = Reflect.getMetadata(PATH_METADATA, fn);
      if (path === undefined) return null;
      return { name: n, path: String(path), guarded: classGuarded || guardsOf(fn).includes(PlatformAdminGuard) };
    })
    .filter((r): r is { name: string; path: string; guarded: boolean } => r !== null);
}

describe('platform-admin endpoints require PlatformAdminGuard', () => {
  it.each([
    AdminAnalyticsController,
    DatabaseOptimizationController,
    QueueMonitorController,
    DunningController,
  ] as unknown as Ctor[])('%p: every route', (ctrl) => {
    const r = routes(ctrl);
    expect(r.length).toBeGreaterThan(0);
    expect(r.filter((x) => !x.guarded)).toEqual([]);
  });

  it.each([CouponsController, AnnouncementsController, DataExportController] as unknown as Ctor[])(
    '%p: every /admin route',
    (ctrl) => {
      const admin = routes(ctrl).filter((x) => x.path === 'admin' || x.path.startsWith('admin/'));
      expect(admin.length).toBeGreaterThan(0);
      expect(admin.filter((x) => !x.guarded)).toEqual([]);
    },
  );

  it('impersonation: start + list need platform admin; end stays open (service checks originator)', () => {
    const r = Object.fromEntries(routes(ImpersonationController as unknown as Ctor).map((x) => [x.name, x.guarded]));
    expect(r).toEqual({ start: true, end: false, list: true });
  });

  it('PlatformAdminGuard refuses a tenant user', () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'tenant_admin', isPlatformAdmin: false } }) }) };
    expect(() => new PlatformAdminGuard().canActivate(ctx as never)).toThrow();
  });
});
