/**
 * TenantContextInterceptor — populates the AsyncLocalStorage tenant context
 * after authentication has run.
 *
 * Lifecycle (NestJS request):
 *   1. TenantContextMiddleware opens an empty ALS frame (store = {tenantId: null})
 *   2. JwtAuthGuard decodes the JWT and attaches `req.user`
 *   3. *** This interceptor *** runs — it patches the same store object that
 *      the middleware created, setting tenantId from req.user.tenantId
 *   4. Handler runs and Prisma queries see the populated tenantId
 *
 * Why patch instead of run() again?
 * ---------------------------------
 * The guards run inside the middleware's `als.run()` callback. If we called
 * `als.run()` again here, the new frame would only exist for the rest of the
 * interceptor's stack — and downstream services that already captured a
 * reference to the OLD store (via getStore()) would still see the empty one.
 *
 * AsyncLocalStorage stores are objects, so mutating the store visible to
 * everyone in the same frame is the documented escape hatch for this exact
 * case (see Node.js AsyncLocalStorage docs § "Mutation of the store").
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { SKIP_TENANT_SCOPE_KEY } from './skip-tenant-scope.decorator';
import { TenantContextStore } from './tenant-context.service';

/**
 * Cross-tenant access is granted by the `isPlatformAdmin` JWT claim ONLY.
 *
 * That claim is derived from which table the account authenticated against
 * (`userType: 'admin'` → the Admin table), never from `User.role` — which is
 * an unconstrained `String` column that tenant-level users control values in.
 * Trusting a role name here once let any tenant user whose row happened to say
 * `role = 'admin'` (a documented legacy alias, see UserRole in
 * common/decorators/roles.decorator.ts) turn off tenant scoping for their whole
 * request, which also bypassed the findUnique guard in TenantScopeMiddleware.
 *
 * Do not reintroduce a role-name allowlist. Role checks belong in RolesGuard,
 * where they gate a route — not here, where they gate the tenant filter itself.
 */

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Mutate the per-request ALS store with the tenantId from req.user.
   *
   * @param context - NestJS execution context
   * @param next - downstream handler
   * @returns the handler's observable (passed through unchanged)
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only meaningful for HTTP — websocket/cron contexts don't have req.user
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<{
      user?: { tenantId?: string | null; isPlatformAdmin?: boolean };
      __tenantStore?: TenantContextStore;
    }>();

    const store = req.__tenantStore;
    if (!store) {
      // Should never happen if TenantContextMiddleware is wired correctly,
      // but treat as fail-open for unauthenticated public endpoints
      return next.handle();
    }

    const skipFromDecorator = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isPlatformUser = Boolean(req.user?.isPlatformAdmin);

    // Mutate the SAME object the middleware put in ALS. References held by
    // downstream code see the update immediately.
    store.tenantId = req.user?.tenantId ?? null;
    store.skipScope = Boolean(skipFromDecorator) || isPlatformUser;

    return next.handle();
  }
}
