/**
 * POS floor roles must be able to work the POS.
 *
 * `create-pos-user.dto.ts` lets a tenant create POS users with role `cashier` or
 * `bartender` (the seeder creates a `cashier`). Neither role is in ROLE_LEVELS,
 * so `getRoleLevel()` returns 0 for them and RolesGuard's hierarchy check can
 * never admit them — the only way in is an exact name match in `@Roles(...)`.
 *
 * Neither name appeared in any restaurant `@Roles` list, so every screen of the
 * POS returned 403 to a cashier: no menu, no tables, no order, no payment.
 *
 * These tests read the real decorator metadata off the controller prototypes, so
 * they fail if someone rewrites a `@Roles` list and drops the POS roles again.
 * They deliberately do NOT assert a level for cashier/bartender — giving them one
 * would grant every endpoint whose floor sits below it, app-wide.
 */
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { RestaurantController } from '../restaurant.controller';
import { OrderController } from '../order/order.controller';
import { TableController } from '../table/table.controller';
import { MenuController } from '../menu/menu.controller';
import { KitchenController } from '../kitchen/kitchen.controller';

const rolesOf = (controller: object, handler: string): string[] =>
  Reflect.getMetadata(ROLES_KEY, (controller as { prototype: object }).prototype[handler]) ?? [];

/** Every route app/pos/page.tsx and app/pos/kitchen/page.tsx call. */
const POS_ROUTES: Array<[string, object, string]> = [
  ['GET /restaurants', RestaurantController, 'findAll'],
  ['GET /restaurants/:id/orders', OrderController, 'findAll'],
  ['POST /restaurants/:id/orders', OrderController, 'create'],
  ['POST /restaurants/:id/orders/:orderId/send-to-kitchen', OrderController, 'sendToKitchen'],
  ['PATCH /restaurants/:id/orders/:orderId/status', OrderController, 'updateStatus'],
  ['GET /restaurants/:id/tables', TableController, 'findAll'],
  ['GET /restaurants/:id/menu-categories', MenuController, 'findAllCategories'],
  ['GET /restaurants/:id/menu-items', MenuController, 'findAllItems'],
  ['PATCH /restaurants/:id/kitchen/items/:itemId/status', KitchenController, 'updateItemStatus'],
];

describe('POS floor roles reach every route the POS screens call', () => {
  it.each(POS_ROUTES)('%s admits cashier', (_route, controller, handler) => {
    expect(rolesOf(controller, handler)).toContain('cashier');
  });

  it.each(POS_ROUTES)('%s admits bartender', (_route, controller, handler) => {
    expect(rolesOf(controller, handler)).toContain('bartender');
  });

  it('does not silently promote them — they stay unranked, exact-match only', () => {
    // A cashier must not inherit `staff` (30) and with it every floor-30 endpoint
    // in bookings, housekeeping and rooms. Guard this by asserting the roles are
    // still absent from the level table.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync('src/common/guards/roles.guard.ts', 'utf8');
    const levelTable = src.slice(
      src.indexOf('const ROLE_LEVELS'),
      src.indexOf('function getRoleLevel'),
    );

    expect(levelTable).not.toMatch(/\bcashier:/);
    expect(levelTable).not.toMatch(/\bbartender:/);
  });
});
