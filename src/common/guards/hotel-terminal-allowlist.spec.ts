// bcrypt's native binding doesn't load in every sandbox — stub it (same as other suites)
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

// H1 (audit 2026-11-09) — pins what a Hotel Terminal token may reach.
// The list was completed by a report-mode walk of every Hotel Terminal page as
// hotel_manager; adding a controller here is a security decision — review it.
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ALLOW_SYSTEMS_KEY } from '../decorators/allow-systems.decorator';
import { BookingsController } from '../../modules/bookings/bookings.controller';
import { RoomsController } from '../../modules/rooms/rooms.controller';
import { GuestsController } from '../../modules/guests/guests.controller';
import { HousekeepingController } from '../../modules/housekeeping/housekeeping.controller';
import { StaffController } from '../../modules/staff/staff.controller';
import { TenantsController } from '../../tenants/tenants.controller';
import { ChartOfAccountsController } from '../../modules/accounting/chart-of-accounts/chart-of-accounts.controller';
import { ArInvoicesController } from '../../modules/accounts-receivable/ar-invoices/ar-invoices.controller';
import { TenantUsersController } from '../../modules/tenant-users/tenant-users.controller';
import { PurchaseOrdersController } from '../../modules/inventory/purchase-orders/purchase-orders.controller';
import { HrController } from '../../modules/hr/hr.controller';
import { CostBudgetsController } from '../../modules/cost-accounting/cost-budgets/cost-budgets.controller';

type Ctor = { prototype: Record<string, unknown>; name: string };
const systemsOf = (t: object): string[] => Reflect.getMetadata(ALLOW_SYSTEMS_KEY, t) ?? [];

/** route → reachable by hotel-terminal? (class OR handler tag, same merge as SystemGuard) */
function reach(ctrl: Ctor): Record<string, boolean> {
  const cls = systemsOf(ctrl).includes('hotel-terminal');
  const out: Record<string, boolean> = {};
  for (const n of Object.getOwnPropertyNames(ctrl.prototype)) {
    if (n === 'constructor') continue;
    const fn = ctrl.prototype[n] as object;
    if (Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;
    out[n] = cls || systemsOf(fn).includes('hotel-terminal');
  }
  return out;
}

describe('Hotel Terminal allow-list (SystemGuard enforced)', () => {
  it.each([BookingsController, RoomsController, GuestsController, HousekeepingController] as unknown as Ctor[])(
    '%p is fully reachable from the Hotel Terminal',
    (ctrl) => {
      const r = reach(ctrl);
      expect(Object.keys(r).length).toBeGreaterThan(0);
      expect(Object.values(r).every(Boolean)).toBe(true);
    },
  );

  it.each([
    ChartOfAccountsController,
    ArInvoicesController,
    TenantUsersController,
    PurchaseOrdersController,
    HrController,
    CostBudgetsController,
  ] as unknown as Ctor[])('%p is NOT reachable from the Hotel Terminal', (ctrl) => {
    const r = reach(ctrl);
    expect(Object.keys(r).length).toBeGreaterThan(0);
    expect(Object.entries(r).filter(([, ok]) => ok)).toEqual([]);
  });

  it('staff: only the list (roster) is reachable — not create / update / delete', () => {
    const r = reach(StaffController as unknown as Ctor);
    const open = Object.entries(r).filter(([, ok]) => ok).map(([n]) => n);
    expect(open).toHaveLength(1);
  });

  it('tenants: only the two "hotels" reads are reachable', () => {
    const r = reach(TenantsController as unknown as Ctor);
    const open = Object.entries(r).filter(([, ok]) => ok).map(([n]) => n);
    expect(open).toHaveLength(2);
  });
});
