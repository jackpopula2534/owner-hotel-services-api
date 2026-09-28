/**
 * Hotel Terminal roles (hotel_manager / front_desk / housekeeper) against the real
 * @Roles metadata of the hotel controllers.
 *
 * hotel_manager and front_desk are unranked in ROLE_LEVELS, so they only get in
 * where they are named. Before this fix they were named nowhere and the Hotel
 * Terminal (incl. SSO launch, which logs in as hotel_manager) got 403 on rooms and
 * bookings.
 */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RoomsController } from './rooms.controller';
import { BookingsController } from '../bookings/bookings.controller';
import { PropertiesController } from '../properties/properties.controller';

const guard = new RolesGuard(new Reflector());

function allowed(role: string, handler: (...args: never[]) => unknown, cls: object): boolean {
  const ctx = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as never;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const rooms = RoomsController.prototype;
const bookings = BookingsController.prototype;
const properties = PropertiesController.prototype;

describe('Hotel Terminal roles', () => {
  it('handlers really carry @Roles metadata (guards the test itself)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, rooms.create)).toBeDefined();
  });

  it('hotel_manager: reads, runs the front desk and edits rooms & prices', () => {
    expect(allowed('hotel_manager', rooms.findAll, RoomsController)).toBe(true);
    expect(allowed('hotel_manager', rooms.create, RoomsController)).toBe(true);
    expect(allowed('hotel_manager', rooms.update, RoomsController)).toBe(true);
    expect(allowed('hotel_manager', bookings.checkIn, BookingsController)).toBe(true);
    expect(allowed('hotel_manager', properties.findAll, PropertiesController)).toBe(true);
  });

  it('hotel_manager: cannot delete rooms or change the property itself (owner only)', () => {
    expect(allowed('hotel_manager', rooms.remove, RoomsController)).toBe(false);
    expect(allowed('hotel_manager', properties.update, PropertiesController)).toBe(false);
  });

  it('front_desk: bookings, check-in and payments — but not room / price master data', () => {
    expect(allowed('front_desk', rooms.findAll, RoomsController)).toBe(true);
    expect(allowed('front_desk', rooms.updateStatus, RoomsController)).toBe(true);
    expect(allowed('front_desk', bookings.checkIn, BookingsController)).toBe(true);
    expect(allowed('front_desk', bookings.addFolioPayment, BookingsController)).toBe(true);
    expect(allowed('front_desk', rooms.create, RoomsController)).toBe(false);
    expect(allowed('front_desk', rooms.update, RoomsController)).toBe(false);
  });

  it('housekeeper: can see rooms and set room status, cannot edit rooms', () => {
    expect(allowed('housekeeper', rooms.findAll, RoomsController)).toBe(true);
    expect(allowed('housekeeper', rooms.updateStatus, RoomsController)).toBe(true);
    expect(allowed('housekeeper', rooms.update, RoomsController)).toBe(false);
  });
});
