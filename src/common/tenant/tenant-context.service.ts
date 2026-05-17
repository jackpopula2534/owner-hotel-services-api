/**
 * TenantContextService — per-request tenant identity, threaded through async work.
 *
 * Why this exists
 * ---------------
 * NestJS controllers and services pass `tenantId` as an explicit argument from
 * the controller down to Prisma. That works only when every developer remembers
 * to do it. The W2 audit found 325 prisma calls that omit `tenantId` from the
 * `where` clause — every one of those is a potential cross-tenant data leak.
 *
 * Solution: store the current request's tenantId in {@link AsyncLocalStorage}
 * so a Prisma Client extension can read it and inject the filter automatically.
 * Async-local storage propagates across `await` boundaries, queue handlers,
 * setTimeout callbacks, etc. — anywhere V8 keeps the async stack alive.
 *
 * Lifecycle
 * ---------
 *   1. {@link TenantContextMiddleware} reads `req.user.tenantId` (set by
 *      JwtAuthGuard) and calls {@link TenantContextService.run}.
 *   2. Everything inside the `run()` callback — including downstream services,
 *      Prisma queries, event emitters — can call {@link getTenantId} to read it.
 *   3. When the request completes, the AsyncLocalStorage frame is dropped.
 *
 * Opt-out
 * -------
 * Platform-admin operations that legitimately span tenants set
 * {@link runUnscoped} or use the `@SkipTenantScope()` decorator. The Prisma
 * extension checks the same flag and omits the auto-injection.
 *
 * @see TenantContextMiddleware
 * @see createTenantScopedPrismaExtension
 * @see SkipTenantScope decorator
 */
import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Shape of the per-request store. Kept minimal so we don't accidentally
 * couple the global async context to request internals.
 */
export interface TenantContextStore {
  /** Tenant the current request is acting on, or `null` for platform-admin */
  tenantId: string | null;
  /** When true, the Prisma extension skips auto-injection (platform queries) */
  skipScope: boolean;
}

@Injectable()
export class TenantContextService {
  private readonly logger = new Logger(TenantContextService.name);
  private readonly als = new AsyncLocalStorage<TenantContextStore>();

  /**
   * Execute `fn` with the supplied tenant context active.
   *
   * @param store - the context to make visible to nested async work
   * @param fn - the function whose entire async tree should see `store`
   * @returns whatever `fn` returns (including resolved promise values)
   */
  run<T>(store: TenantContextStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  /**
   * Run `fn` with tenant scoping disabled. Use ONLY for platform-admin paths
   * that intentionally need to read across tenants (e.g. billing rollups).
   *
   * @param fn - the function to run without scoping
   */
  runUnscoped<T>(fn: () => T): T {
    return this.als.run({ tenantId: null, skipScope: true }, fn);
  }

  /**
   * Get the current request's tenantId, or `null` outside a request
   * (e.g. cron job, application bootstrap).
   *
   * @returns tenantId string, or `null` if no context / platform-admin
   */
  getTenantId(): string | null {
    return this.als.getStore()?.tenantId ?? null;
  }

  /**
   * Whether the Prisma extension should skip its auto-injection for the
   * current call site. Set by `runUnscoped` or by the `@SkipTenantScope()`
   * decorator (via TenantScopeInterceptor).
   *
   * @returns true if scoping should be bypassed for the current async frame
   */
  isScopeSkipped(): boolean {
    return this.als.getStore()?.skipScope ?? false;
  }

  /**
   * Whether there is an active tenant context. Useful for code paths that
   * want to noop outside a request (e.g. seeders, REPL).
   *
   * @returns true if a context is active in the current async frame
   */
  hasContext(): boolean {
    return this.als.getStore() !== undefined;
  }
}
