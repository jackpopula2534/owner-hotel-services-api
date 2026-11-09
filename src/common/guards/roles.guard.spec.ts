import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createExecutionContext = (user: any = {}) => {
    const request = {
      user,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should allow access to public routes', () => {
    const context = createExecutionContext();

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return true;
      if (key === ROLES_KEY) return undefined;
      return undefined;
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when no roles are required', () => {
    const context = createExecutionContext({ role: 'user' });

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return undefined;
      return undefined;
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user has no role', () => {
    const context = createExecutionContext({});

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'] as UserRole[];
      return undefined;
    });

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow access when user has required role', () => {
    const context = createExecutionContext({ role: 'admin' });

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin', 'manager'] as UserRole[];
      return undefined;
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role not in required roles', () => {
    const context = createExecutionContext({ role: 'user' });

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'] as UserRole[];
      return undefined;
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  /**
   * The hierarchy check is a FLOOR: `userLevel >= min(requiredRoles.map(level))`.
   *
   * `getRoleLevel()` returns 0 for any role missing from ROLE_LEVELS. So a single
   * unranked role anywhere in a @Roles list drags the floor to 0, and `userLevel
   * >= 0` is true for every authenticated caller — the list stops gating anything.
   *
   * `crm_manager`, `crm_agent` and `sales_rep` are declared in UserRole and named
   * by 54 @Roles decorators across the CRM and loyalty controllers, but none of
   * them is in ROLE_LEVELS. Every one of those endpoints was open to any caller
   * holding any role at all.
   */
  describe('an unranked role in @Roles must not open the endpoint to everyone', () => {
    const withRoles = (userRole: string, required: string[]) => {
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === ROLES_KEY) return required as UserRole[];
        return undefined;
      });
      return createExecutionContext({ role: userRole });
    };

    it('denies a housekeeper on a CRM endpoint listing crm_manager', () => {
      // DELETE /crm/contacts/:id — @Roles(admin, manager, tenant_admin,
      // platform_admin, crm_manager). crm_manager is unranked, so the floor
      // collapsed to 0 and a housekeeper (40) deleted contacts.
      const ctx = withRoles('housekeeper', [
        'admin',
        'manager',
        'tenant_admin',
        'platform_admin',
        'crm_manager',
      ]);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('denies the lowest-ranked role (user, level 10) just the same', () => {
      const ctx = withRoles('user', ['manager', 'crm_manager']);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('denies a role that is itself unranked (level 0 vs floor 0)', () => {
      const ctx = withRoles('some_role_nobody_declared', ['manager', 'crm_manager']);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('still admits the unranked role itself, by exact match', () => {
      // crm_manager needs no level: it is named in the list. Exact match runs
      // before the hierarchy check, which is why dropping the floor to 0 buys
      // these roles nothing — it only leaks access to everyone else.
      const ctx = withRoles('crm_manager', ['admin', 'manager', 'crm_manager']);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('still admits a ranked role above the floor of the ranked entries', () => {
      // manager (80) >= min(admin 90, manager 80) = 80.
      const ctx = withRoles('manager', ['admin', 'manager', 'crm_manager']);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('still admits platform_admin, whose level towers over every floor', () => {
      const ctx = withRoles('platform_admin', ['manager', 'crm_manager']);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('denies everyone but an exact match when NO required role is ranked', () => {
      // No ranked entry => no floor exists => the hierarchy admits nobody, not
      // even platform_admin. Fail closed: such a @Roles list is opting out of
      // inheritance, and guessing otherwise is how the floor hit 0 to begin with.
      expect(() => guard.canActivate(withRoles('manager', ['crm_agent']))).toThrow(
        ForbiddenException,
      );
      expect(() => guard.canActivate(withRoles('platform_admin', ['crm_agent']))).toThrow(
        ForbiddenException,
      );
      expect(guard.canActivate(withRoles('crm_agent', ['crm_agent']))).toBe(true);
    });
  });
});
