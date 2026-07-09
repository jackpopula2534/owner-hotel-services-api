/**
 * Unit tests for TenantGuard — the defense-in-depth layer that blocks a request
 * whose JWT tenantId disagrees with the tenantId in the route.
 *
 * Regression guard: the bypass must key on the `isPlatformAdmin` JWT claim, not
 * on a role-name allowlist. `User.role` is an unconstrained String column and
 * `'admin'` is a documented legacy alias for a TENANT-level role, so the old
 * allowlist let an ordinary hotel user read any other tenant's data by id.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';

type ReqUser = { tenantId?: string; role?: string; isPlatformAdmin?: boolean };

function contextFor(user: ReqUser | undefined, params: Record<string, string> = {}) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user, params, query: {} }) }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false); // not @Public()
    guard = new TenantGuard(reflector);
  });

  /** A request from `user` reaching for tenant-b's data. */
  const reachAcrossTenants = (user: ReqUser) =>
    guard.canActivate(contextFor(user, { tenantId: 'tenant-b' }));

  describe('cross-tenant access', () => {
    it('blocks a tenant user reaching into another tenant', () => {
      expect(() =>
        reachAcrossTenants({ tenantId: 'tenant-a', role: 'manager', isPlatformAdmin: false }),
      ).toThrow(ForbiddenException);
    });

    // The original vulnerability: each of these roles is TENANT-level, but the
    // old PLATFORM_ROLES allowlist waved them through.
    it.each([['admin'], ['super_admin'], ['tenant_admin'], ['owner']])(
      'blocks a tenant user with role=%s',
      (role) => {
        expect(() =>
          reachAcrossTenants({ tenantId: 'tenant-a', role, isPlatformAdmin: false }),
        ).toThrow(ForbiddenException);
      },
    );

    it('allows a platform admin to reach any tenant', () => {
      expect(reachAcrossTenants({ role: 'platform_admin', isPlatformAdmin: true })).toBe(true);
    });

    it('allows a request whose JWT tenant matches the route tenant', () => {
      const ctx = contextFor(
        { tenantId: 'tenant-a', role: 'manager', isPlatformAdmin: false },
        { tenantId: 'tenant-a' },
      );

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('routes with nothing to check', () => {
    it('allows a route with no tenantId param or query', () => {
      const ctx = contextFor({ tenantId: 'tenant-a', role: 'manager', isPlatformAdmin: false });

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows @Public() routes', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      expect(guard.canActivate(contextFor(undefined, { tenantId: 'tenant-b' }))).toBe(true);
    });

    it('defers to JwtAuthGuard when no user is attached yet (global-guard ordering)', () => {
      expect(guard.canActivate(contextFor(undefined, { tenantId: 'tenant-b' }))).toBe(true);
    });
  });
});
