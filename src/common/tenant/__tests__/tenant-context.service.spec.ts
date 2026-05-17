/**
 * Unit tests for TenantContextService.
 *
 * Verifies the AsyncLocalStorage contract:
 *   • Values set in `run()` are visible to all sync + async work inside the callback
 *   • Frames are isolated — nested `run()` doesn't leak to the parent
 *   • Outside any `run()`, getters return safe defaults (null / false)
 *   • runUnscoped() sets skipScope=true even without a tenantId
 */
import { TenantContextService } from '../tenant-context.service';

describe('TenantContextService', () => {
  let svc: TenantContextService;

  beforeEach(() => {
    svc = new TenantContextService();
  });

  describe('outside any run() frame', () => {
    it('getTenantId() returns null', () => {
      expect(svc.getTenantId()).toBeNull();
    });

    it('isScopeSkipped() returns false', () => {
      expect(svc.isScopeSkipped()).toBe(false);
    });

    it('hasContext() returns false', () => {
      expect(svc.hasContext()).toBe(false);
    });
  });

  describe('inside run()', () => {
    it('makes tenantId visible synchronously', () => {
      svc.run({ tenantId: 'tenant-1', skipScope: false }, () => {
        expect(svc.getTenantId()).toBe('tenant-1');
        expect(svc.hasContext()).toBe(true);
      });
    });

    it('propagates across await boundaries', async () => {
      await svc.run({ tenantId: 'tenant-1', skipScope: false }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(svc.getTenantId()).toBe('tenant-1');
      });
    });

    it('returns the callback return value', () => {
      const result = svc.run({ tenantId: 'tenant-1', skipScope: false }, () => 42);
      expect(result).toBe(42);
    });

    it('mutation of the store is visible (used by the interceptor)', async () => {
      // The middleware sets a placeholder store; the interceptor later
      // mutates `tenantId`. This test ensures the mutation is observable.
      const store = { tenantId: null as string | null, skipScope: false };
      await svc.run(store, async () => {
        expect(svc.getTenantId()).toBeNull();
        store.tenantId = 'tenant-late-bound';
        expect(svc.getTenantId()).toBe('tenant-late-bound');
      });
    });
  });

  describe('runUnscoped()', () => {
    it('sets skipScope=true with tenantId=null', () => {
      svc.runUnscoped(() => {
        expect(svc.isScopeSkipped()).toBe(true);
        expect(svc.getTenantId()).toBeNull();
      });
    });
  });

  describe('frame isolation', () => {
    it('nested run() does not leak to parent', () => {
      svc.run({ tenantId: 'outer', skipScope: false }, () => {
        expect(svc.getTenantId()).toBe('outer');
        svc.run({ tenantId: 'inner', skipScope: false }, () => {
          expect(svc.getTenantId()).toBe('inner');
        });
        expect(svc.getTenantId()).toBe('outer');
      });
    });

    it('parallel runs are isolated', async () => {
      const seen: Array<string | null> = [];
      await Promise.all([
        svc.run({ tenantId: 'A', skipScope: false }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(svc.getTenantId());
        }),
        svc.run({ tenantId: 'B', skipScope: false }, async () => {
          await new Promise((r) => setTimeout(r, 2));
          seen.push(svc.getTenantId());
        }),
      ]);
      expect(seen.sort()).toEqual(['A', 'B']);
    });
  });
});
