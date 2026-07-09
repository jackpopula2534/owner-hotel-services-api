/**
 * Unit tests for TenantContextInterceptor.
 *
 * The interceptor decides ONE security-critical bit per request: `skipScope`,
 * which switches off tenant filtering in TenantScopeMiddleware entirely. These
 * tests pin down who is allowed to set it.
 *
 * Regression guard: `skipScope` must derive from the `isPlatformAdmin` JWT
 * claim, never from `req.user.role`. `User.role` is an unconstrained String
 * column and `'admin'` is a documented legacy alias for a TENANT-level role
 * (see UserRole in common/decorators/roles.decorator.ts), so a role allowlist
 * here handed cross-tenant read/write to ordinary hotel users.
 */
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TenantContextInterceptor } from '../tenant-context.interceptor';
import { TenantContextStore } from '../tenant-context.service';

type ReqUser = { tenantId?: string | null; role?: string; isPlatformAdmin?: boolean };

/** Build an HTTP ExecutionContext carrying `user` and a fresh ALS store. */
function httpContext(user: ReqUser | undefined, store: TenantContextStore) {
  return {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user, __tenantStore: store }) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of(null) };

const emptyStore = (): TenantContextStore => ({ tenantId: null, skipScope: false });

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    interceptor = new TenantContextInterceptor(reflector);
  });

  /** Run the interceptor and hand back the store it mutated. */
  const run = (user: ReqUser | undefined): TenantContextStore => {
    const store = emptyStore();
    interceptor.intercept(httpContext(user, store), next);
    return store;
  };

  describe('skipScope is granted only by the isPlatformAdmin claim', () => {
    it('grants skipScope to a platform admin', () => {
      const store = run({ isPlatformAdmin: true, role: 'platform_admin', tenantId: null });
      expect(store.skipScope).toBe(true);
    });

    // Each of these is a TENANT-level user. None may escape their tenant,
    // no matter what their (free-text, DB-controlled) role column says.
    it.each([
      ['admin', 'legacy tenant-admin alias — the original vulnerability'],
      ['super_admin', 'a retired role — an unknown string must not be privileged'],
      ['tenant_admin', 'hotel owner — highest tenant role, still tenant-bound'],
      ['owner', 'tenant owner'],
      ['manager', 'ordinary staff role'],
    ])('denies skipScope to role=%s (%s)', (role) => {
      const store = run({ isPlatformAdmin: false, role, tenantId: 'tenant-a' });

      expect(store.skipScope).toBe(false);
      expect(store.tenantId).toBe('tenant-a');
    });

    it('denies skipScope when the role claim is absent', () => {
      expect(run({ isPlatformAdmin: false, tenantId: 'tenant-a' }).skipScope).toBe(false);
    });

    it('ignores a forged role even when isPlatformAdmin is explicitly false', () => {
      const store = run({ isPlatformAdmin: false, role: 'admin', tenantId: 'tenant-a' });
      expect(store.skipScope).toBe(false);
    });
  });

  describe('@SkipTenantScope() decorator', () => {
    it('grants skipScope to a tenant user on a decorated route', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      expect(run({ isPlatformAdmin: false, role: 'manager', tenantId: 'tenant-a' }).skipScope).toBe(
        true,
      );
    });
  });

  describe('tenantId propagation', () => {
    it('copies tenantId from the JWT into the store', () => {
      expect(run({ isPlatformAdmin: false, role: 'manager', tenantId: 'tenant-a' }).tenantId).toBe(
        'tenant-a',
      );
    });

    it('leaves tenantId null when the request has no user', () => {
      const store = run(undefined);

      expect(store.tenantId).toBeNull();
      expect(store.skipScope).toBe(false);
    });
  });

  describe('non-HTTP contexts', () => {
    it('leaves the store untouched (no req.user to read)', () => {
      const store = emptyStore();
      const wsContext = { getType: () => 'ws' } as unknown as ExecutionContext;

      interceptor.intercept(wsContext, next);

      expect(store).toEqual({ tenantId: null, skipScope: false });
    });
  });
});
