// H1.1 (audit 2026-11-09) — every terminal with its own login is enforced by
// SystemGuard. Each allow-list was completed by walking every page in report mode
// and re-walked with enforcement on (0 failures). This spec pins the boundaries
// between terminals so a future @AllowSystems change is a visible decision.
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ALLOW_SYSTEMS_KEY } from '../decorators/allow-systems.decorator';
import { HrPayrollController } from '../../modules/hr/hr-payroll.controller';
import { HrController } from '../../modules/hr/hr.controller';
import { ChartOfAccountsController } from '../../modules/accounting/chart-of-accounts/chart-of-accounts.controller';
import { JournalEntriesController } from '../../modules/accounting/journal-entries/journal-entries.controller';
import { ArInvoicesController } from '../../modules/accounts-receivable/ar-invoices/ar-invoices.controller';
import { PurchaseOrdersController } from '../../modules/inventory/purchase-orders/purchase-orders.controller';
import { StockCountsController } from '../../modules/inventory/stock-counts/stock-counts.controller';
import { ProcurementUsersController } from '../../modules/procurement-users/procurement-users.controller';
import { TenantUsersController } from '../../modules/tenant-users/tenant-users.controller';
import { BookingsController } from '../../modules/bookings/bookings.controller';
import { UsersController } from '../../modules/users/users.controller';
import { NotificationsController } from '../../notifications/notifications.controller';

type Ctor = { prototype: Record<string, unknown>; name: string };
const sys = (t: object): string[] => Reflect.getMetadata(ALLOW_SYSTEMS_KEY, t) ?? [];
/** systems that can reach EVERY route of the controller (class ∪ handler, as SystemGuard merges) */
function reachAll(ctrl: Ctor): Set<string> {
  const cls = sys(ctrl);
  const per = Object.getOwnPropertyNames(ctrl.prototype)
    .filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, ctrl.prototype[n] as object) !== undefined)
    .map((n) => new Set([...cls, ...sys(ctrl.prototype[n] as object)]));
  return per.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))), per[0] ?? new Set());
}
/** systems that can reach AT LEAST ONE route */
function reachAny(ctrl: Ctor): Set<string> {
  const cls = sys(ctrl);
  const out = new Set(cls);
  for (const n of Object.getOwnPropertyNames(ctrl.prototype)) {
    if (n === 'constructor') continue;
    for (const s of sys(ctrl.prototype[n] as object)) out.add(s);
  }
  return out;
}

const TERMINALS = ['hotel-terminal', 'hr', 'accounting', 'procurement', 'warehouse'];
const C = (x: unknown) => x as Ctor;

describe.each([
  // [controller, terminals that own it]
  [C(HrPayrollController), ['hr']],
  [C(HrController), ['hr']],
  [C(ChartOfAccountsController), ['accounting']],
  [C(JournalEntriesController), ['accounting']],
  [C(ArInvoicesController), ['accounting']],
  [C(PurchaseOrdersController), ['procurement', 'warehouse']],
  [C(StockCountsController), ['warehouse']],
  [C(ProcurementUsersController), ['procurement']],
  [C(BookingsController), ['hotel-terminal']],
])('%p', (ctrl, owners) => {
  it(`is fully reachable from ${owners.join(' + ')}`, () => {
    const all = reachAll(ctrl);
    for (const o of owners) expect(all.has(o)).toBe(true);
  });
  it('is not reachable at all from the other terminals', () => {
    const any = reachAny(ctrl);
    for (const t of TERMINALS.filter((x) => !owners.includes(x))) expect(any.has(t)).toBe(false);
  });
});

it('tenant users (seat / access management) is owner-console only', () => {
  expect([...reachAny(C(TenantUsersController))]).toEqual([]);
});

it('profile + notifications are shared by every terminal', () => {
  for (const c of [C(UsersController), C(NotificationsController)]) {
    const any = reachAny(c);
    for (const t of TERMINALS) expect(any.has(t)).toBe(true);
  }
});
