import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CAMP_MASTER_WRITE_ROLES, CAMP_OPS_WRITE_ROLES, CAMP_READ_ROLES } from './camp-roles';

/** Run RolesGuard for a user role against an endpoint's @Roles list. */
const allowed = (role: string, required: string[]): boolean => {
  const reflector = {
    getAllAndOverride: (key: string) => (key === 'roles' ? required : false),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as never;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
};

describe('camp roles — master data is set up by managers, staff run the day', () => {
  it('Camp Terminal staff can read and run operations', () => {
    expect(allowed('camp_staff', CAMP_READ_ROLES)).toBe(true);
    expect(allowed('camp_staff', CAMP_OPS_WRITE_ROLES)).toBe(true);
  });

  it('Camp Terminal staff cannot change zones, prices, pitches or the map', () => {
    expect(allowed('camp_staff', CAMP_MASTER_WRITE_ROLES)).toBe(false);
    expect(allowed('staff', CAMP_MASTER_WRITE_ROLES)).toBe(false);
    expect(allowed('receptionist', CAMP_MASTER_WRITE_ROLES)).toBe(false);
  });

  it('camp manager, owner and main-system managers can change master data', () => {
    for (const role of ['camp_manager', 'tenant_admin', 'manager', 'admin', 'platform_admin']) {
      expect(allowed(role, CAMP_MASTER_WRITE_ROLES)).toBe(true);
    }
  });

  it('camp manager can read and run operations too', () => {
    expect(allowed('camp_manager', CAMP_READ_ROLES)).toBe(true);
    expect(allowed('camp_manager', CAMP_OPS_WRITE_ROLES)).toBe(true);
  });
});
